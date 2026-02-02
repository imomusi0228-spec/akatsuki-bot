// index.js（完成形：丸ごとコピペでOK）

import http from "node:http";
import crypto from "node:crypto";
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Client,
  Collection,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  MessageFlags,
  Events,
  ChannelType, // ← 追加
} from "discord.js";

import pg from "pg";
const { Pool } = pg;
import { getLicenseTierStrict, setTierOverride, getLicenseTier } from "./service/license.js";
import { checkActivityStats } from "./service/activity.js";
import {
  renderNeedLoginHTML,
  renderAdminDashboardHTML,
  renderAdminSettingsHTML,
  renderAdminActivityHTML,
  escapeHTML
} from "./service/views.js";
import { syncGuildCommands, clearGlobalCommands } from "./service/commands.js";
import { isTierAtLeast } from "./utils/common.js";
import { getNgWords, addNgWord, removeNgWord, clearNgWords } from "./service/ng.js";

/* =========================
   Log thread helpers (DISKなしでも動く版)
   - Threads are separated by kind (vc_in / vc_out / ng / settings ...)
   - One thread per day per kind
   - Race-safe (in-process lock)
   - DBがあれば thread_id を保存（なければ毎回探索で復元）
   - 親チャンネルは settings.log_channel_id（DB）→ env LOG_CHANNEL_ID → 探索
========================= */

// 同一プロセス内の同時実行防止
const _logThreadLocks = new Map();

/**
 * kind: "vc_in" | "vc_out" | "ng" | "settings" | ...
 */
function threadNameFor(kind, dateKey) {
  if (kind === "vc_in") return `VC IN ${dateKey}`;
  if (kind === "vc_out") return `VC OUT ${dateKey}`;
  if (kind === "ng") return `NGワード ${dateKey}`;
  if (kind === "settings") return `SETTINGS ${dateKey}`;
  return `LOG ${kind} ${dateKey}`;
}

function todayKeyTokyo() {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date()); // YYYY-MM-DD
}

async function findExistingForumThreadByName(parentForum, name) {
  // 1) Active threads
  try {
    const active = await parentForum.threads.fetchActive();
    const hit = active?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  // 2) Archived public threads
  try {
    const archived = await parentForum.threads.fetchArchived({
      type: "public",
      limit: 100,
    });
    const hit = archived?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  // 3) Cache fallback
  try {
    const hit = parentForum.threads.cache.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  return null;
}

async function findExistingTextThreadByName(parent, name) {
  // Text系チャンネルのスレッド用（GuildText / News など）
  if (!parent?.threads?.fetchActive) return null;

  // 1) Active threads
  try {
    const active = await parent.threads.fetchActive();
    const hit = active?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  // 2) Archived public threads
  try {
    const archived = await parent.threads.fetchArchived({
      type: "public",
      limit: 100,
    });
    const hit = archived?.threads?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  // 3) Cache fallback
  try {
    const hit = parent.threads?.cache?.find((t) => t.name === name);
    if (hit) return hit;
  } catch (_) { }

  return null;
}

/** DBから log_channel_id を取る（DBが死んでても落とさない） */
async function getLogChannelIdSafe(guildId) {
  // 1) DB settings
  try {
    if (db) {
      const row = await db.get(
        `SELECT log_channel_id FROM settings WHERE guild_id = ?`,
        guildId
      );
      const v = String(row?.log_channel_id || "").trim();
      if (v) return v;
    }
  } catch (_) { }

  // 2) env
  const envId = String(process.env.LOG_CHANNEL_ID || "").trim();
  if (envId) return envId;

  return null;
}

/** 保険：VC/NG/SETTINGSっぽいスレがある親チャンネルを探す（重いので最後） */
function looksLikeLogThreadName(name = "") {
  const n = String(name || "");
  return (
    n.startsWith("VC IN ") ||
    n.startsWith("VC OUT ") ||
    n.startsWith("NGワード ") ||
    n.startsWith("SETTINGS ") ||
    n.startsWith("LOG ")
  );
}

async function findParentBySearchingThreads(guild) {
  const col = await guild.channels.fetch().catch(() => null);
  const chans = col ? Array.from(col.values()) : Array.from(guild.channels.cache.values());

  for (const ch of chans) {
    if (!ch) continue;

    // Forum
    if (ch.type === ChannelType.GuildForum) {
      try {
        const active = await ch.threads.fetchActive();
        if (active?.threads?.some((t) => looksLikeLogThreadName(t.name))) return ch;

        const archived = await ch.threads.fetchArchived({ type: "public", limit: 50 });
        if (archived?.threads?.some((t) => looksLikeLogThreadName(t.name))) return ch;
      } catch (_) { }
    }

    // Text + thread
    if (ch.threads?.fetchActive) {
      try {
        const active = await ch.threads.fetchActive();
        if (active?.threads?.some((t) => looksLikeLogThreadName(t.name))) return ch;

        const archived = await ch.threads.fetchArchived({ type: "public", limit: 50 });
        if (archived?.threads?.some((t) => looksLikeLogThreadName(t.name))) return ch;
      } catch (_) { }
    }
  }

  return null;
}

/** thread_id をDBに保存（DBがある時だけ） */
async function dbSaveThreadIdSafe(guildId, dateKey, kind, threadId) {
  try {
    if (!db) return;
    await db.run(
      `INSERT INTO log_threads (guild_id, date_key, kind, thread_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, date_key, kind)
       DO UPDATE SET thread_id = EXCLUDED.thread_id`,
      guildId,
      dateKey,
      kind,
      threadId
    );
  } catch (_) { }
}

/** thread_id をDBから読む（DBがある時だけ） */
async function dbGetThreadIdSafe(guildId, dateKey, kind) {
  try {
    if (!db) return null;
    const row = await db.get(
      `SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ? AND kind = ?`,
      guildId,
      dateKey,
      kind
    );
    const id = String(row?.thread_id || "").trim();
    if (!id || id === "PENDING") return null;
    return id;
  } catch (_) {
    return null;
  }
}

async function ensureLogThread(guild, kind) {
  const dateKey = todayKeyTokyo();
  const name = threadNameFor(kind, dateKey);

  // ---- in-process lock key（同一プロセス内の二重作成防止）
  const lockKey = `${guild.id}:${kind}:${dateKey}`;
  if (_logThreadLocks.has(lockKey)) return await _logThreadLocks.get(lockKey);

  const lockedPromise = (async () => {
    // ---- 0) 親チャンネルIDを決める（DB → env → 探索）
    let logChannelId = await getLogChannelIdSafe(guild.id);

    // logChannelId が無いなら最後の保険で探索
    let parent = null;

    if (logChannelId) {
      parent =
        guild.channels.cache.get(logChannelId) ||
        (await guild.channels.fetch(logChannelId).catch(() => null));
    }

    if (!parent) {
      parent = await findParentBySearchingThreads(guild);
      // ここで見つかった場合、IDを env/DB に保存はしない（Diskなしで変わるので）
    }

    if (!parent) return null;

    // ---- 1) DBに既存 thread_id があればそれを優先（DBがある時だけ）
    const savedThreadId = await dbGetThreadIdSafe(guild.id, dateKey, kind);
    if (savedThreadId) {
      const ch =
        guild.channels.cache.get(savedThreadId) ||
        (await guild.channels.fetch(savedThreadId).catch(() => null));
      if (ch) return ch;
    }

    // ---- 2) まず「既にあるか」を探す（Forum / Text）
    if (parent.type === ChannelType.GuildForum) {
      const existing = await findExistingForumThreadByName(parent, name);
      if (existing) {
        await dbSaveThreadIdSafe(guild.id, dateKey, kind, existing.id);
        return existing;
      }
    } else {
      const existing = await findExistingTextThreadByName(parent, name);
      if (existing) {
        await dbSaveThreadIdSafe(guild.id, dateKey, kind, existing.id);
        return existing;
      }
    }

    // ✅ 最終防衛：作成直前にもう一回「存在チェック」
    if (parent.type === ChannelType.GuildForum) {
      const ex2 = await findExistingForumThreadByName(parent, name);
      if (ex2) {
        await dbSaveThreadIdSafe(guild.id, dateKey, kind, ex2.id);
        return ex2;
      }
    } else {
      const ex2 = await findExistingTextThreadByName(parent, name);
      if (ex2) {
        await dbSaveThreadIdSafe(guild.id, dateKey, kind, ex2.id);
        return ex2;
      }
    }

    // ✅ 作成できない親チャンネルなら中止
    if (parent.type !== ChannelType.GuildForum && !parent?.threads?.create) {
      console.warn("⚠️ log parent cannot create threads:", parent?.type, parent?.id);
      return null;
    }

    // ---- 3) 作成
    let thread = null;

    if (parent.type === ChannelType.GuildForum) {
      thread = await parent.threads.create({
        name,
        autoArchiveDuration: 1440,
        message: { content: `ログ開始: ${name}` },
      });
    } else {
      thread = await parent.threads.create({
        name,
        autoArchiveDuration: 1440,
      });
      await thread.send(`ログ開始: ${name}`);
    }

    await dbSaveThreadIdSafe(guild.id, dateKey, kind, thread.id);
    return thread;
  })();

  _logThreadLocks.set(lockKey, lockedPromise);

  try {
    return await lockedPromise;
  } finally {
    _logThreadLocks.delete(lockKey);
  }
}

async function sendToKindThread(guild, kind, payload) {
  const th = await ensureLogThread(guild, kind);
  if (!th) return false;
  await th.send(payload).catch(() => null);
  return true;
}

/* =========================
   VC log message builder (plain text like your 2nd screenshot)
========================= */

function vcText(member, action, channelName) {
  // action: "joined" | "left"
  // 例: "@乱重@Mana left voice channel 🔇 総合雑談VC"
  const m = member?.toString?.() ?? "@unknown";
  if (action === "joined") return `${m} joined voice channel 🔊 ${channelName}`;
  if (action === "left") return `${m} left voice channel 🔇 ${channelName}`;
  return `${m} voice channel ${channelName}`;
}

/* =========================
   Example: NG word logging (plain text)
   - kind "ng"
========================= */

// どこかで NG 判定したときにこう呼ぶだけ
async function logNgWord(message, hitWord) {
  const guild = message.guild;
  if (!guild) return;

  const author = message.author?.toString?.() ?? "@unknown";
  const chName = message.channel?.name ? `#${message.channel.name}` : "unknown-channel";
  const now = tokyoNowLabel();

  const text = `${now} ${author} NGワード検出「${hitWord}」 in ${chName}\n${message.content}`;
  await sendToKindThread(guild, "ng", text);
}

/* =========================
   Basic helpers (text/html/json)
========================= */
function text(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
  res.end(body ?? "");
}
function html(res, body, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(body ?? "");
}
function json(res, obj, status = 200, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(obj));
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}






/* =========================
   Settings
========================= */
const DEFAULT_NG_THRESHOLD = Number(process.env.NG_THRESHOLD || 3);
const DEFAULT_TIMEOUT_MIN = Number(process.env.NG_TIMEOUT_MIN || 10);
const TIMEZONE = "Asia/Tokyo";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const PUBLIC_URL = process.env.PUBLIC_URL || "";
const REDIRECT_PATH = "/oauth/callback";
const OAUTH_REDIRECT_URI = PUBLIC_URL ? `${PUBLIC_URL}${REDIRECT_PATH} ` : "";
const OAUTH_SCOPES = "identify guilds";

/** 429対策（guilds短期キャッシュ） */
const USER_GUILDS_CACHE_TTL_MS = 60_000;
const guildsInFlightBySid = new Map(); // sid -> Promise<guilds>

/* =========================
   Paths
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   DB (Postgres)
========================= */
let db = null;

/* パラメータ変換ヘルパー (?, ?, ? -> $1, $2, $3) */
function convertSqlParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i} `);
}

function makeDb(pool) {
  return {
    async get(sql, ...params) {
      const r = await pool.query(convertSqlParams(sql), params.flat());
      return r.rows[0] ?? null;
    },
    async all(sql, ...params) {
      const r = await pool.query(convertSqlParams(sql), params.flat());
      return r.rows ?? [];
    },
    async run(sql, ...params) {
      const r = await pool.query(convertSqlParams(sql), params.flat());
      return { changes: r.rowCount ?? 0 };
    },
    async exec(sql) {
      await pool.query(sql);
      return true;
    },
  };
}

async function ensureBaseTables(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings(
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT,
  ng_threshold INTEGER DEFAULT ${DEFAULT_NG_THRESHOLD},
  timeout_minutes INTEGER DEFAULT ${DEFAULT_TIMEOUT_MIN},
  activity_weeks INTEGER DEFAULT 4,
  intro_channel_id TEXT,
  target_role_id TEXT
);

    CREATE TABLE IF NOT EXISTS ng_words(
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'literal',
  word TEXT NOT NULL,
  flags TEXT NOT NULL DEFAULT 'i',
  PRIMARY KEY(guild_id, kind, word)
);

    CREATE TABLE IF NOT EXISTS ng_hits(
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT,
  PRIMARY KEY(guild_id, user_id)
);

    CREATE TABLE IF NOT EXISTS log_threads(
  guild_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  PRIMARY KEY(guild_id, date_key, kind)
);

    CREATE TABLE IF NOT EXISTS vc_sessions(
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  channel_id TEXT,
  join_ts    BIGINT NOT NULL,
  PRIMARY KEY(guild_id, user_id)
);

    CREATE TABLE IF NOT EXISTS log_events(
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  type TEXT,
  user_id TEXT,
  ts BIGINT NOT NULL,
  meta TEXT,
  duration_ms BIGINT
);

    CREATE INDEX IF NOT EXISTS idx_log_events_guild_ts ON log_events(guild_id, ts);
    CREATE INDEX IF NOT EXISTS idx_log_events_guild_type_ts ON log_events(guild_id, type, ts);

    CREATE TABLE IF NOT EXISTS licenses(
  guild_id TEXT PRIMARY KEY,
  notes TEXT,
  expires_at BIGINT,
  tier TEXT DEFAULT 'free'
);

    CREATE TABLE IF NOT EXISTS processed_messages(
  message_id TEXT PRIMARY KEY,
  processed_at BIGINT
);
`);
}

async function runDbMigrations(db) {
  // Add columns if they don't exist (Postgres)
  try {
    await db.exec(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS activity_weeks INTEGER DEFAULT 4`);
    await db.exec(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS intro_channel_id TEXT`);
    await db.exec(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS target_role_id TEXT`);

    // License table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS licenses(
  guild_id TEXT PRIMARY KEY,
  notes TEXT,
  expires_at BIGINT,
  tier TEXT DEFAULT 'free'
);
`);
    // Add tier column if missing
    await db.exec(`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'free'`);
  } catch (e) {
    console.error("Migration error:", e.message);
  }
  return true;
}



// Re-export for compatibility if needed elsewhere, but ideally update consumers.
export { setTierOverride, getLicenseTier, getLicenseTierStrict };



// =========================
// DB init (Postgres) + Ready gate
// =========================
const DATABASE_URL = (process.env.DATABASE_URL || "").trim();

const dbReady = (async () => {
  if (!DATABASE_URL) {
    console.log("ℹ️ DATABASE_URL が設定されていません。データベースなしで起動します。");
    db = null;
    return false;
  }

  const MAX_RETRIES = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let pool = null;
    let client = null;
    try {
      console.log(`⏳ DB Connection attempt ${attempt}/${MAX_RETRIES}...`);
      pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: { rejectUnauthorized: false }, // Supabase/Neon向けに保険
        connectionTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        max: 5,
        keepAlive: true,
      });

      // 接続テスト: test-db.js と同じ方式 (QueryではなくConnect)
      client = await pool.connect();

      console.log("  ✅ Connected. Verifying query...");
      await client.query("SELECT 1");

      // クライアントを一度リリース
      client.release();
      client = null;

      // ✅ 一時変数で初期化（まだグローバル db には入れない）
      const _db = makeDb(pool);

      // テーブル作成（下のSQLを実行）
      await ensureBaseTables(_db);
      await runDbMigrations(_db);

      // ✅ ここで初めてグローバルに代入（準備完了）
      db = _db;

      console.log("✅ DB ready (Postgres)");
      return true;
    } catch (e) {
      lastError = e;
      const errMsg = e?.message || String(e);
      console.warn(`⚠️ DB connection attempt ${attempt}/${MAX_RETRIES} failed: ${errMsg}`);

      if (client) {
        try { client.release(); } catch (_) { }
      }
      if (pool) {
        try { await pool.end(); } catch (_) { }
      }

      if (attempt < MAX_RETRIES) {
        // Wait 3s before retry
        await new Promise((res) => setTimeout(res, 3000));
      }
    }
  }

  // If all retries fail
  const msg = lastError?.message || String(lastError);
  // タイムアウトや接続エラーの場合は短く表示
  if (msg.includes("ETIMEDOUT") || msg.includes("ECONNREFUSED") || msg.includes("5342")) {
    console.warn(`⚠️ DB connection failed after ${MAX_RETRIES} attempts (${msg}). Running without database.`);
  } else {
    console.error("❌ DB init failed:", msg);
    if (lastError?.errors) {
      lastError.errors.forEach((err, i) => console.error(`  [${i}] ${err.message} (${err.address})`));
    }
  }
  console.log("💡 ヒント: データベースを使用しない場合は、環境変数 DATABASE_URL を削除または空にしてください。");
  db = null;
  return false;
})();

/* =========================
   Discord client
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});
client.commands = new Collection();

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

// commands/*.js
try {
  const commandsPath = path.join(__dirname, "commands");
  if (fs.existsSync(commandsPath)) {
    const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
    for (const file of files) {
      const filePath = path.join(commandsPath, file);
      const mod = await importFile(filePath);
      if (mod?.data?.name && typeof mod.execute === "function") {
        client.commands.set(mod.data.name, mod);
      }
    }
  }
} catch (e) {
  console.error("❌ Command load failed:", e?.message ?? e);
}

/* =========================
   Utils
========================= */
function normalize(s) {
  return (s ?? "").toLowerCase();
}
// todayKeyTokyo2 was a duplicate of todayKeyTokyo
function monthKeyTokyo(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
  });
  return dtf.format(date); // YYYY-MM
}
function tokyoMonthRangeUTC(monthStr) {
  const [y, m] = monthStr.split("-").map((x) => Number(x));
  if (!y || !m) return null;
  const start = Date.UTC(y, m - 1, 1, -9, 0, 0, 0);
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, -9, 0, 0, 0);
  return { start, end };
}
function rand(n = 24) {
  return crypto.randomBytes(n).toString("hex");
}
function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function tokyoNowLabel() {
  const dtf = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return dtf.format(new Date());
}

const _ngProcessedCache = new Set();
function markNgProcessed(msgId) {
  if (_ngProcessedCache.has(msgId)) return false;
  _ngProcessedCache.add(msgId);
  if (_ngProcessedCache.size > 1000) {
    const it = _ngProcessedCache.values();
    for (let i = 0; i < 200; i++) _ngProcessedCache.delete(it.next().value);
  }
  return true;
}

// ✅ DBを使った排他制御（重複防止の完全版）
async function acquireMessageLock(messageId) {
  if (!db) return markNgProcessed(messageId); // DBがない場合は既存のメモリチェック

  try {
    // 古いレコードの削除（メンテナンス）- 10分以上前
    // ※ 1%の確率で実行（毎回呼ぶと重いため）
    if (Math.random() < 0.01) {
      db.run("DELETE FROM processed_messages WHERE processed_at < $1", Date.now() - 600000).catch(() => { });
    }

    // INSERT成功ならロック取得、失敗（重複）ならロック済み
    await db.run("INSERT INTO processed_messages (message_id, processed_at) VALUES ($1, $2)", messageId, Date.now());
    return true;
  } catch (e) {
    // Postgres unique_violation: 23505
    if (String(e?.code) === '23505') return false;

    // SQLite constraint failed (if using sqlite locally for test)
    if (String(e?.message).includes('UNIQUE constraint failed')) return false;

    console.warn("DB Lock error, fallback to memory:", e.message);
    return markNgProcessed(messageId); // DBエラー時はメモリにフォールバック
  }
}

// parseNgInput moved to service/ng.js but might be used by commands/ngword.js (which now imports it from service/ng.js)
// If index.js doesn't use it, we can remove it. Checking usages... 
// index.js used it in addNgWord/removeNgWord which are being removed.
// We remove it here.

function overlapMs(start1, end1, start2, end2) {
  const s = Math.max(start1, start2);
  const e = Math.min(end1, end2);
  return Math.max(0, e - s);
}

/* =========================
   Settings / NG (with Cache)
========================= */
const settingsCache = new Map(); // guildId -> { data, ts }
// ngWordsCache moved to service/ng.js
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function invalidateCache(guildId) {
  settingsCache.delete(guildId);
  // ngWordsCache handled in service/ng.js
}

async function getSettings(guildId) {
  // 1. Check cache
  const cached = settingsCache.get(guildId);
  if (cached && (Date.now() - cached.ts < CACHE_TTL_MS)) {
    return cached.data;
  }

  // 2. Default fallback
  const dflt = {
    log_channel_id: null,
    ng_threshold: DEFAULT_NG_THRESHOLD,
    timeout_minutes: DEFAULT_TIMEOUT_MIN,
  };

  if (!db) return dflt;

  // 3. Fetch DB
  const row = await db.get(
    "SELECT * FROM settings WHERE guild_id = $1",
    guildId
  );

  let result = dflt;
  if (row) {
    result = {
      log_channel_id: row.log_channel_id ?? null,
      ng_threshold: Number(row.ng_threshold ?? DEFAULT_NG_THRESHOLD),
      timeout_minutes: Number(row.timeout_minutes ?? DEFAULT_TIMEOUT_MIN),
    };
  }

  // 4. Set cache
  settingsCache.set(guildId, { data: result, ts: Date.now() });
  return result;
}

async function updateSettings(
  guildId,
  { log_channel_id = null, ng_threshold, timeout_minutes }
) {
  if (!db) return { ok: false, error: "db_not_ready" };

  const nt = Number(ng_threshold);
  const tm = Number(timeout_minutes);

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE SET
       log_channel_id = EXCLUDED.log_channel_id,
       ng_threshold   = EXCLUDED.ng_threshold,
       timeout_minutes= EXCLUDED.timeout_minutes`,
    guildId,
    log_channel_id,
    Number.isFinite(nt) ? nt : DEFAULT_NG_THRESHOLD,
    Number.isFinite(tm) ? tm : DEFAULT_TIMEOUT_MIN
  );

  invalidateCache(guildId); // Clear cache
  return { ok: true };
}

// getNgWords, addNgWord, removeNgWord, clearNgWords moved to service/ng.js

/* =========================
   Event logging (stats)
========================= */
async function logEvent(guildId, type, userId, meta = {}, durationMs = null) {
  if (!db) return;

  const ts = Date.now();
  const metaJson = JSON.stringify(meta ?? {});

  await db.run(
    `INSERT INTO log_events (guild_id, type, user_id, ts, meta, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    guildId,
    type,
    userId,
    ts,
    metaJson,
    durationMs
  );
}

/* =========================
   Discord API (OAuth)
========================= */
async function discordApi(accessToken, apiPath, method = "GET", body = null, extraHeaders = null, maxRetries = 4) {
  const url = `https://discord.com/api/v10${apiPath}`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "AkatsukiBotAdmin/1.0",
      ...(extraHeaders || {}),
    };

    const r = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    if (r.ok) {
      const t = await r.text().catch(() => "");
      return t ? JSON.parse(t) : null;
    }

    if (r.status === 429) {
      let waitMs = 1000;
      const ra = r.headers.get("retry-after");
      if (ra) {
        const sec = Number(ra);
        if (Number.isFinite(sec)) waitMs = Math.ceil(sec * 1000);
      } else {
        try {
          const data = await r.json();
          if (typeof data?.retry_after === "number") waitMs = Math.ceil(data.retry_after * 1000);
        } catch { }
      }
      waitMs += 250 + Math.floor(Math.random() * 250);
      if (attempt === maxRetries) throw new Error(`Discord API ${apiPath} failed: 429`);
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }

    const msg = await r.text().catch(() => "");
    throw new Error(`Discord API ${apiPath} failed: ${r.status} ${msg}`);
  }
  throw new Error(`Discord API ${apiPath} failed`);
}

function hasAdminPerm(permStr) {
  try {
    const p = BigInt(permStr ?? "0");
    const ADMINISTRATOR = 1n << 3n; // 0x8
    const MANAGE_GUILD = 1n << 5n; // 0x20
    return (p & ADMINISTRATOR) !== 0n || (p & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
}

/* =========================
   OAuth session store (memory)
========================= */
const sessions = new Map(); // sid -> { accessToken, user, guilds, guildsFetchedAt, expiresAt }
const states = new Map();   // state -> createdAt

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf("=");
      if (idx < 0) return;
      out[pair.slice(0, idx)] = decodeURIComponent(pair.slice(idx + 1));
    });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push("Path=/");
  parts.push("SameSite=Lax");
  if (opts.secure !== false) parts.push("Secure");
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  res.setHeader("Set-Cookie", parts.join("; "));
}
function delCookie(res, name) {
  res.setHeader("Set-Cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies.sid || "";
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt && Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...s };
}

async function ensureGuildsForSession(s) {
  const now = Date.now();
  if (s.guilds && Array.isArray(s.guilds) && s.guildsFetchedAt && now - s.guildsFetchedAt < USER_GUILDS_CACHE_TTL_MS) {
    return s.guilds;
  }

  const inflight = guildsInFlightBySid.get(s.sid);
  if (inflight) return await inflight;

  const p = (async () => {
    try {
      const guilds = await discordApi(s.accessToken, "/users/@me/guilds");
      const raw = sessions.get(s.sid);
      if (raw) {
        raw.guilds = guilds;
        raw.guildsFetchedAt = Date.now();
        sessions.set(s.sid, raw);
      }
      return guilds;
    } catch (e) {
      if (s.guilds && Array.isArray(s.guilds) && s.guilds.length > 0) return s.guilds;
      throw e;
    }
  })().finally(() => {
    guildsInFlightBySid.delete(s.sid);
  });

  guildsInFlightBySid.set(s.sid, p);
  return await p;
}

function resolveUserLabel(guild, userId) {
  try {
    // ギルドメンバー優先（表示名あり）
    const mem = guild.members.cache.get(userId);
    if (mem) {
      const display = mem.displayName;
      const username = mem.user.username;
      return `${display} (@${username})`;
    }

    // 次にユーザーキャッシュ
    const u = client.users.cache.get(userId);
    if (u) {
      return `${u.username} (@${u.username})`;
    }
  } catch { }

  // 最後の保険
  return userId;
}

/* =========================
   Ready / Commands (NO EPHEMERAL / NO REPLY UI)
   - Always ACK once (public) to avoid "応答しませんでした"
   - Immediately delete the reply UI when possible
   - Provide publicSend() for normal messages
   - DO NOT rely on interaction.reply/editReply/followUp in commands
========================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isUserContextMenuCommand()) return;

  const isUnknown = (err) => err?.code === 10062 || err?.rawError?.code === 10062;
  const isAlreadyAcked = (err) => {
    const c = err?.code ?? err?.rawError?.code ?? err?.name;
    return (
      c === 40060 ||
      c === "InteractionAlreadyReplied" ||
      String(c).includes("AlreadyReplied")
    );
  };

  // ✅ コマンドUIを使う前提なので publicSend は「補助」扱い（使わなくてもOK）
  interaction.publicSend = async (payload) => {
    return await interaction.channel?.send(payload).catch(() => null);
  };

  try {
    // License Check
    const tier = await getLicenseTierStrict(interaction.guildId, db);
    if (tier === "none" && interaction.commandName !== "license") {
      await interaction.reply({ content: "🚫 このサーバーではライセンスが有効ではありません (License Required)", flags: MessageFlags.Ephemeral });
      return;
    }
    // Inject tier into interaction for commands
    interaction.userTier = tier;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
      // ここは見えるように ephemeral
      await interaction.reply({ content: `❌ コマンドが見つかりません: /${interaction.commandName}`, flags: MessageFlags.Ephemeral }).catch(() => null);
      return;
    }

    await command.execute(interaction, db);
  } catch (err) {
    console.error("interactionCreate error:", err);
    if (isUnknown(err)) return;

    const msg = `❌ エラー: ${err?.message ?? String(err)}`;

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: msg }).catch(() => null);
      } else {
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    } catch (e) {
      if (isUnknown(e) || isAlreadyAcked(e)) return;
      // 最後の保険：通常投稿
      await interaction.publicSend({ content: msg }).catch(() => null);
    }
  }
});

/* =========================
   VC Join/Leave -> kind="vc_in" / kind="vc_out"
   - スレ分け：IN / OUT（MOVEは両方に出す）
   - 追加：vc_sessions で入室中も集計できるようにする
========================= */
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild) return;

    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;

    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    // ✅ チャンネルが変わってない（mute/deaf等）は全部無視
    if (oldCh === newCh) return;

    if ((await getLicenseTierStrict(guild.id, db)) === "none") return; // License Check

    const who = member.displayName || member.user?.username || member.id;
    const timeLabel = tokyoNowLabel();

    // ===== VC IN =====
    if (!oldCh && newCh) {
      const embedIn = new EmbedBuilder()
        .setColor(0x00ff7f)
        .setTitle("VC IN")
        .setDescription(
          `**${who}** joined voice channel 🔊 <#${newCh}>\n\nID\n${member.id}・${timeLabel}`
        )
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_in", { embeds: [embedIn] });

      // DB保存
      if (db) {
        await db.run(
          `INSERT INTO vc_sessions (guild_id, user_id, channel_id, join_ts) VALUES ($1, $2, $3, $4)
           ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_id=EXCLUDED.channel_id, join_ts=EXCLUDED.join_ts`,
          guild.id, member.id, newCh, Date.now()
        );
        await logEvent(guild.id, "vc_in", member.id, { channel_id: newCh });
      }
      return;
    }

    // ===== VC OUT =====
    if (oldCh && !newCh) {
      const embedOut = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle("VC OUT")
        .setDescription(
          `**${who}** left voice channel 🔇 <#${oldCh}>\n\nID\n${member.id}・${timeLabel}`
        )
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_out", { embeds: [embedOut] });

      // DB保存 & 精算
      if (db) {
        const sess = await db.get(`SELECT join_ts FROM vc_sessions WHERE guild_id=$1 AND user_id=$2`, guild.id, member.id);
        if (sess) {
          const durationMs = Date.now() - Number(sess.join_ts);
          await logEvent(guild.id, "vc_out", member.id, { channel_id: oldCh, duration_ms: durationMs }, durationMs);
          await db.run(`DELETE FROM vc_sessions WHERE guild_id=$1 AND user_id=$2`, guild.id, member.id);
        } else {
          // セッションなし（再起動後など）
          await logEvent(guild.id, "vc_out", member.id, { channel_id: oldCh, error: "no_session" });
        }
      }
      return;
    }

    // ===== VC MOVE =====
    if (oldCh && newCh && oldCh !== newCh) {
      const embedMove = new EmbedBuilder()
        .setColor(0x4dabf7)
        .setTitle("VC MOVE")
        .setDescription(
          `**${who}** moved voice channel\n<#${oldCh}> → <#${newCh}>\n\nID\n${member.id}・${timeLabel}`
        )
        .setTimestamp(new Date());

      await sendToKindThread(guild, "vc_move", { embeds: [embedMove] });

      // DB更新
      if (db) {
        await db.run(
          `UPDATE vc_sessions SET channel_id=$1 WHERE guild_id=$2 AND user_id=$3`,
          newCh, guild.id, member.id
        );
        await logEvent(guild.id, "vc_move", member.id, { from: oldCh, to: newCh });
      }
    }
  } catch (e) {
    console.error("VoiceStateUpdate error:", e);
  }
});

/* =========================
   NG detection -> kind="ng"
   - log BEFORE delete (keep deleted content)
   - warn DM (fallback mention)
   - Color: NG orange / Timeout purple
   - includes message debug log (A案)
========================= */
function escapeRegExp(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKatakanaOnly(s = "") {
  // カタカナ/長音/中点 だけで構成されるか
  return /^[\u30A0-\u30FF\u30FC\u30FB]+$/u.test(String(s));
}

/**
 * @returns {string[]} マッチしたパターンの配列（重複を許容）
 */
function matchNg(content, ngList) {
  const text = String(content ?? "");
  const hits = [];

  // 1. Regex patterns
  for (const w of ngList) {
    if (w.kind === "regex") {
      try {
        const re = new RegExp(w.word, (w.flags || "i").includes("g") ? w.flags : (w.flags || "i") + "g");
        let m;
        while ((m = re.exec(text)) !== null) {
          hits.push(`/${w.word}/${w.flags || "i"}`);
          if (re.lastIndex === m.index) re.lastIndex++; // Avoid infinite loops for zero-width matches
        }
      } catch { }
    }
  }

  // 2. Separate Katakana NG words and others
  const katakanaNg = ngList
    .filter(w => w.kind !== "regex" && isKatakanaOnly(w.word))
    .map(w => w.word.toLowerCase());

  const otherNg = ngList.filter(w => w.kind !== "regex" && !isKatakanaOnly(w.word));

  // 3. Process Katakana blocks (Smart Partitioning to avoid things like "バカンス")
  // Extract all Katakana blocks (including long vowel marks and middle dots)
  const katakanaBlocks = text.match(/[\u30A0-\u30FF\u30FC\u30FB]+/g) || [];

  for (const block of katakanaBlocks) {
    const blockLower = block.toLowerCase();
    // Try to partition the block *entirely* using known NG words
    const partition = findNgPartition(blockLower, katakanaNg);
    if (partition) {
      partition.forEach(w => {
        // Find original casing if needed, but here we just use the registered word
        const found = ngList.find(x => x.kind !== "regex" && x.word.toLowerCase() === w.toLowerCase());
        hits.push(found ? found.word : w);
      });
    }
  }

  // 4. Process non-Katakana (or mixed) NG words normally
  const textLower = text.toLowerCase();
  for (const w of otherNg) {
    const needle = String(w.word ?? "").toLowerCase();
    if (needle) {
      let pos = textLower.indexOf(needle);
      while (pos !== -1) {
        hits.push(w.word);
        pos = textLower.indexOf(needle, pos + needle.length);
      }
    }
  }

  return hits;
}

/**
 * Katakana block partitioning: check if the block consists *entirely* of registered NG words.
 */
function findNgPartition(text, words, memo = new Map()) {
  if (text === "") return [];
  if (memo.has(text)) return memo.get(text);

  // Longest match first to be more precise
  const sortedWords = [...words].sort((a, b) => b.length - a.length);

  for (const w of sortedWords) {
    if (text.startsWith(w)) {
      const sub = findNgPartition(text.slice(w.length), words, memo);
      if (sub !== null) {
        const res = [w, ...sub];
        memo.set(text, res);
        return res;
      }
    }
  }

  memo.set(text, null);
  return null;
}

async function incNgHit(guildId, userId, delta = 1) {
  if (!db) return 0;
  if (delta <= 0) delta = 1;

  const now = Date.now();

  // ✅ Postgres: INSERT ... ON CONFLICT DO UPDATE
  await db.run(
    `INSERT INTO ng_hits (guild_id, user_id, count, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET
       count = ng_hits.count + EXCLUDED.count,
       updated_at = EXCLUDED.updated_at`,
    guildId,
    userId,
    delta,
    now
  );

  const row = await db.get(
    `SELECT count FROM ng_hits WHERE guild_id = $1 AND user_id = $2`,
    guildId,
    userId
  );

  return Number(row?.count ?? 0);
}

client.on(Events.MessageCreate, async (message) => {
  try {
    if (!message.guild || message.author?.bot) return;

    // ★ ここが 0 なら「Message Content Intent がOFF」濃厚
    const contentText = message.content ?? "";

    console.log("🧪 Message seen:", {
      guild: message.guild.id,
      channel: message.channelId,
      author: message.author.id,
      len: contentText.length,
      contentHead: contentText.slice(0, 30),
    });

    // ✅ DBロックで重複排除
    if (!(await acquireMessageLock(message.id))) return;

    const guildId = message.guild.id;

    if ((await getLicenseTierStrict(guildId, db)) === "none") return; // License Check

    // NG一覧
    const ngList = await getNgWords(db, guildId);
    if (!ngList.length) return;

    // 本文が取れてない（intent OFFなど）
    if (!contentText) {
      console.warn("⚠️ message.content is empty. (Message Content Intent OFF?)", {
        guildId,
        channelId: message.channelId,
        authorId: message.author.id,
      });
      return;
    }

    const matches = matchNg(contentText, ngList);
    if (matches.length === 0) return;
    const matchLabel = matches.join(", ");

    const st = await getSettings(guildId);

    const member = message.member;
    const authorName = message.author?.username || message.author?.id;
    const displayName = member?.displayName || message.author?.globalName || authorName;
    const avatar = message.author?.displayAvatarURL?.() ?? null;

    const timeLabel = tokyoNowLabel();
    const idLine = `${message.author.id}・${timeLabel}`;

    // ===== ① NGログ（削除前） =====
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setAuthor({ name: authorName, iconURL: avatar || undefined })
      .setDescription(`@${displayName} NG word detected in <#${message.channelId}>`)
      .addFields(
        { name: "Matched", value: matchLabel, inline: true },
        { name: "ID", value: idLine, inline: true },
        {
          name: "Content",
          value: contentText.length > 900 ? contentText.slice(0, 900) + "…" : contentText,
          inline: false,
        }
      )
      .setTimestamp(new Date());

    await sendToKindThread(message.guild, "ng", { embeds: [embed] });

    await logEvent(guildId, "ng_detected", message.author.id, {
      channel_id: message.channelId,
      matched: matchLabel,
      message_id: message.id,
    });

    // ===== ② 削除（失敗理由を必ず出す） =====
    const delOk = await message.delete().then(() => true).catch((e) => {
      console.error("❌ NG delete failed:", {
        code: e?.code,
        name: e?.name,
        message: e?.message,
      });
      return false;
    });

    if (!delOk) {
      // ここが出るなら 99% 権限（Manage Messages） or チャンネル上書き
      await message.channel
        .send("⚠️ NG検知したけど削除できません。Botに「メッセージ管理」権限があるか確認してください。")
        .then((msg) => setTimeout(() => msg.delete().catch(() => null), 8000))
        .catch(() => null);
    }

    // ===== ③ 個人警告（DM → fallback mention） =====
    const warnText =
      `⚠️ **NGワード警告**\n` +
      `あなたのメッセージは削除されました。\n\n` +
      `該当: ${matchLabel}\n` +
      `繰り返すとタイムアウト等の処分が行われます。`;

    const dmOk = await message.author
      .send(warnText)
      .then(() => true)
      .catch(() => false);

    if (!dmOk) {
      await message.channel
        .send({ content: `<@${message.author.id}> ${warnText}` })
        .then((msg) => setTimeout(() => msg.delete().catch(() => null), 10_000))
        .catch(() => null);
    }

    // ===== ④ 回数加算 → 閾値でタイムアウト =====
    const count = await incNgHit(guildId, message.author.id, matches.length);
    const threshold = Number(st.ng_threshold ?? DEFAULT_NG_THRESHOLD);
    const timeoutMin = Number(st.timeout_minutes ?? DEFAULT_TIMEOUT_MIN);

    if (count >= threshold) {
      const mem = await message.guild.members.fetch(message.author.id).catch(() => null);

      if (mem) {
        if (!mem.moderatable) {
          // 権限不足で処分できない場合（サーバー所有者やBotより上位の役職）
          await logEvent(guildId, "timeout_failed_hierarchy", message.author.id, { threshold, count });
          await message.channel.send(`⚠️ <@${message.author.id}> はサーバー所有者またはBotより上位の役職のため、自動処分（タイムアウト）をスキップしました。`)
            .then(m => setTimeout(() => m.delete().catch(() => { }), 10000))
            .catch(() => { });
          return;
        }

        const ok = await mem.timeout(timeoutMin * 60_000, "NGワード検出の累積").then(() => true).catch((e) => {
          console.error("❌ timeout failed:", e?.code, e?.message);
          return false;
        });

        if (ok) {
          await logEvent(guildId, "timeout_applied", message.author.id, {
            minutes: timeoutMin,
            threshold,
            count,
          });

          // ✅ 修正: タイムアウト成功時に違反カウントをリセット
          if (db) {
            await db.run(
              `DELETE FROM ng_hits WHERE guild_id = $1 AND user_id = $2`,
              guildId,
              message.author.id
            ).catch(() => { });
          }

          const embed2 = new EmbedBuilder()
            .setColor(0x8e44ad)
            .setAuthor({ name: authorName, iconURL: avatar || undefined })
            .setDescription(`@${displayName} timeout applied`)
            .addFields(
              { name: "Count", value: String(count), inline: true },
              { name: "Duration(min)", value: String(timeoutMin), inline: true },
              { name: "ID", value: idLine, inline: false }
            )
            .setTimestamp(new Date());

          await sendToKindThread(message.guild, "ng", { embeds: [embed2] });
        }
      }
    }
  } catch (e) {
    console.error("MessageCreate NG handler error:", e);
  }
});

async function getVcUserMonthLive(guildId, userId, ym) {
  const range = tokyoMonthRangeUTC(ym);
  if (!range) return null;

  const row = await db.get(
    `SELECT
       COALESCE(SUM(COALESCE(duration_ms, 0)), 0) AS dur,
       COUNT(*) AS cnt
     FROM log_events
     WHERE guild_id = ?
       AND user_id = ?
       AND ts >= ?
       AND ts < ?
       AND type IN ('vc_out', 'vc_move')`,
    [guildId, userId, range.start, range.end]
  );

  let durMs = Number(row?.dur || 0);
  const cnt = Number(row?.cnt || 0);

  const sess = await db.get(
    `SELECT join_ts FROM vc_sessions WHERE guild_id=? AND user_id=?`,
    [guildId, userId]
  );

  if (sess?.join_ts) {
    const now = Date.now();
    const extra = overlapMs(Number(sess.join_ts), now, range.start, range.end);
    durMs += extra;
  }

  return { durMs, cnt };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

async function getMonthlyStats({ db, guildId, ym }) {
  if (!db || !guildId || !ym) return null;

  const range = tokyoMonthRangeUTC(ym);
  if (!range) return null;

  const { start, end } = range;

  // 今月のイベント全部（必要なら meta も読む）
  const rows = await db.all(
    `SELECT type, user_id, meta, ts, duration_ms
       FROM log_events
      WHERE guild_id = ?
        AND ts >= ?
        AND ts < ?
      ORDER BY ts DESC`,
    guildId,
    start,
    end
  );

  const byType = {};
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;

  const summary = {
    ngDetected: byType["ng_detected"] || 0,
    timeouts: byType["timeout_applied"] || 0,
    joins: byType["vc_in"] || 0,
    leaves: byType["vc_out"] || 0,
    byType,
  };

  // Top NG Users（今月）
  const topRows = await db.all(
    `SELECT user_id, COUNT(*) AS cnt
       FROM log_events
      WHERE guild_id = ?
        AND ts >= ?
        AND ts < ?
        AND type = 'ng_detected'
        AND user_id IS NOT NULL AND user_id <> ''
      GROUP BY user_id
      ORDER BY cnt DESC
      LIMIT 10`,
    guildId,
    start,
    end
  );

  const guild = client.guilds.cache.get(guildId);

  const topNgUsers = topRows.map((r) => {
    const uid = String(r.user_id);
    return {
      user_id: uid,
      user_label: guild ? resolveUserLabel(guild, uid) : uid,
      cnt: Number(r.cnt || 0),
    };
  });

  return { ym, summary, topNgUsers };
}

/* =========================
   Web server: admin + API + OAuth（機能は既存のまま使う）
   - ★ 重複宣言しない（PORT/server はここで1回だけ）
   - ★ /admin は「OAuth or（任意で）token」どっちでもOK
   - ★ tokenログインでも cookie セッションを発行して /api を安定化（重要）
   - ★ intersectUserBotGuilds 未定義を解消（ここで定義）
========================= */

const PORT = Number(process.env.PORT || 10000);

// ★ cookie secure 判定（Render など reverse proxy 対応）
function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return !!req.socket?.encrypted;
}

// ★ OAuthスコープ/リダイレクト（既存の同名 const を再宣言しない）
const oauthScopesLocal = (process.env.OAUTH_SCOPES || "identify guilds").trim();
const oauthRedirectUriLocal = (process.env.OAUTH_REDIRECT_URI || "").trim();

// ★ ユーザー所属ギルド × Botが入っているギルド を交差
//   - ManageGuild または Administrator 権限のあるものだけ
function intersectUserBotGuilds(userGuilds) {
  if (!Array.isArray(userGuilds)) return [];

  // Botが入ってるGuild ID
  const botGuildIds = new Set(client.guilds.cache.map((g) => g.id));

  return userGuilds
    .filter((g) => {
      // Use BigInt via hasAdminPerm to safely check permissions
      // (Number() loses precision for large permission bitfields)
      return hasAdminPerm(g.permissions) && botGuildIds.has(g.id);
    })
    .map((g) => ({ id: g.id, name: g.name }));
}

const server = http.createServer(async (req, res) => {
  try {

    const u = new URL(req.url || "/", baseUrl(req));
    const pathname = (u.pathname || "/").replace(/\/+$/, "") || "/";

    // health
    if (pathname === "/health") return text(res, "ok", 200);

    // token auth（使いたくないなら ADMIN_TOKEN を空にすれば無効）
    const tokenQ = u.searchParams.get("token") || "";
    const tokenAuthed = !!(ADMIN_TOKEN && tokenQ === ADMIN_TOKEN);

    // session（必要なときだけ読む）
    let sess = null;
    if (
      pathname.startsWith("/admin") ||
      pathname.startsWith("/api/") ||
      pathname === "/logout" ||
      pathname === "/login" ||
      pathname === REDIRECT_PATH
    ) {
      sess = await getSession(req);
    }

    // OAuthが使えるか
    const inferredPublicUrl = process.env.PUBLIC_URL?.trim() || "";
    const oauthReady = !!(CLIENT_ID && CLIENT_SECRET && (inferredPublicUrl || req.headers.host));

    // ★ tokenログインでも cookie セッション化して /api を token無しで叩けるようにする
    //    さらに token をURLに残さない（漏洩対策）
    if (pathname === "/admin" && tokenAuthed && !sess) {
      const sid = rand(24);
      sessions.set(sid, {
        tokenMode: true,
        accessToken: null,
        user: null,
        guilds: null,
        guildsFetchedAt: 0,
        expiresAt: Date.now() + 7 * 24 * 3600 * 1000, // 7日
      });

      setCookie(res, "sid", sid, {
        maxAge: 7 * 24 * 3600,
        httpOnly: true,
        sameSite: "Lax",
        secure: isHttps(req),
      });

      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    // 認証判定：tokenは「そのリクエストURLに付いてる場合」だけ。
    // ただし上で token→sess 化するので通常は sess が立つ。
    const isAuthed = tokenAuthed || !!sess;

    // ===== OAuth endpoints =====
    if (pathname === "/login") {
      if (!oauthReady) {
        return text(res, "OAuth not configured. Set DISCORD_CLIENT_ID/SECRET and PUBLIC_URL.", 500);
      }

      const state = rand(12);
      states.set(state, Date.now());

      const publicBase = inferredPublicUrl || baseUrl(req);
      const redirectUri = oauthRedirectUriLocal || `${publicBase}${REDIRECT_PATH}`;

      const authUrl =
        "https://discord.com/oauth2/authorize" +
        `?client_id=${encodeURIComponent(CLIENT_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(oauthScopesLocal)}` +
        `&state=${encodeURIComponent(state)}`;

      res.writeHead(302, { Location: authUrl });
      return res.end();
    }

    if (pathname === REDIRECT_PATH) {
      if (!oauthReady) return text(res, "OAuth is not configured.", 500);

      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      const created = states.get(state);
      if (!code || !state || !created) return text(res, "Invalid OAuth state/code", 400);
      states.delete(state);

      const publicBase = inferredPublicUrl || baseUrl(req);
      const redirectUri = oauthRedirectUriLocal || `${publicBase}${REDIRECT_PATH}`;

      const body = new URLSearchParams();
      body.set("client_id", CLIENT_ID);
      body.set("client_secret", CLIENT_SECRET);
      body.set("grant_type", "authorization_code");
      body.set("code", code);
      body.set("redirect_uri", redirectUri);

      const tr = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tr.ok) return text(res, `Token exchange failed: ${tr.status}`, 500);
      const tok = await tr.json();

      const user = await discordApi(tok.access_token, "/users/@me");
      const sid = rand(24);

      sessions.set(sid, {
        tokenMode: false,
        accessToken: tok.access_token,
        user,
        guilds: null,
        guildsFetchedAt: 0,
        expiresAt: Date.now() + Number(tok.expires_in || 3600) * 1000,
      });

      setCookie(res, "sid", sid, {
        maxAge: Number(tok.expires_in || 3600),
        httpOnly: true,
        sameSite: "Lax",
        secure: isHttps(req),
      });

      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    if (pathname === "/logout") {
      if (sess?.sid) sessions.delete(sess.sid);
      delCookie(res, "sid");
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    // ===== Pages =====
    if (pathname === "/") {
      // リダイレクト: 既定は /admin へ
      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    if (pathname === "/admin") {
      // メニュー（リダイレクト）: ログイン済みなら dashboard, 未なら login
      if (!isAuthed) {
        // login ページを表示
        return html(res, renderNeedLoginHTML({ oauthReady, tokenEnabled: !!ADMIN_TOKEN }));
      }
      // 既定のダッシュボードへリダイレクト
      res.writeHead(302, { Location: "/admin/dashboard" });
      return res.end();
    }

    // サブページ
    if (pathname.startsWith("/admin/")) {
      if (!isAuthed) {
        return html(res, renderNeedLoginHTML({ oauthReady, tokenEnabled: !!ADMIN_TOKEN }));
      }

      const userObj = sess?.user || null;
      if (pathname === "/admin/dashboard") {
        return html(res, renderAdminDashboardHTML({ user: userObj }));
      }
      if (pathname === "/admin/settings") {
        return html(res, renderAdminSettingsHTML({ user: userObj }));
      }
      if (pathname === "/admin/activity") {
        return html(res, renderAdminActivityHTML({ user: userObj }));
      }

      return text(res, "Page Not Found", 404);
    }

    // ===== APIs =====
    if (pathname.startsWith("/api/")) {
      const ok = await dbReady;
      if (!ok || !db) return json(res, { ok: false, error: "db_not_ready" }, 503);

      if (!isAuthed) {
        console.warn(`[API] Unauthorized: ${req.method} ${pathname}`, {
          hasSid: !!parseCookies(req).sid,
          tokenAuthed,
          remoteIp: req.headers["x-forwarded-for"] || req.socket.remoteAddress
        });
        return json(res, { ok: false, error: "unauthorized" }, 401);
      }

      // OAuth時は「ユーザー所属 && Bot導入 && ManageGuild/Admin」だけ許可
      let allowedGuildIds = null;
      if (sess?.accessToken) {
        const userGuilds = await ensureGuildsForSession(sess);
        const allowed = intersectUserBotGuilds(userGuilds);
        allowedGuildIds = new Set(allowed.map((g) => g.id));
      }

      // tokenログイン（sessはあるが accessToken が無い）も含め、
      // Botが入ってる鯖だけOKにする
      async function isBotInGuild(guildId) {
        if (!guildId) return false;

        // ① まずキャッシュを見る（速い）
        if (client.guilds.cache.has(guildId)) {
          return true;
        }

        // ② 無ければ API から取得
        const guilds = await client.guilds.fetch().catch(() => null);
        if (guilds && guilds.has(guildId)) {
          return true;
        }

        return false;
      }

      async function requireGuildAllowed(guildId) {
        if (!guildId) return { ok: false, status: 400, error: "missing_guild" };

        if (allowedGuildIds) {
          if (!allowedGuildIds.has(guildId)) return { ok: false, status: 403, error: "forbidden_guild" };
          return { ok: true };
        }

        const inGuild = await isBotInGuild(guildId);
        if (!inGuild) return { ok: false, status: 403, error: "bot_not_in_guild" };
        return { ok: true };
      }

      // /api/health
      if (pathname === "/api/health") return json(res, { ok: true });

      // /api/me
      if (pathname === "/api/me") {
        return json(res, {
          ok: true,
          oauth: !!sess?.accessToken,
          token: !sess?.accessToken,
          user: sess?.user
            ? { id: sess.user.id, username: sess.user.username, global_name: sess.user.global_name }
            : null,
          botGuildCount: client.guilds.cache.size,
        });
      }

      // /api/guilds
      if (pathname === "/api/guilds") {
        if (!sess?.accessToken) {
          // tokenログイン：Botが入ってる鯖を返す
          const col = await client.guilds.fetch().catch(() => null);
          const list = col
            ? Array.from(col.values()).map((g) => ({ id: g.id, name: g.name }))
            : client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
          return json(res, { ok: true, guilds: list });
        }

        // OAuth：ユーザー所属 && Bot導入 && ManageGuild/Admin
        const userGuilds = await ensureGuildsForSession(sess);
        const guilds = intersectUserBotGuilds(userGuilds);
        return json(res, { ok: true, guilds });
      }

      // /api/ngwords
      if (pathname === "/api/ngwords") {
        const guildId = u.searchParams.get("guild") || "";
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const words = await getNgWords(db, guildId);
        return json(res, { ok: true, count: words.length, words });
      }

      // /api/ngwords/add
      if (pathname === "/api/ngwords/add" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body.guild || "");
        const word = String(body.word || "");
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const r = await addNgWord(db, guildId, word);
        return json(res, r, r.ok ? 200 : 400);
      }

      // /api/ngwords/remove
      if (pathname === "/api/ngwords/remove" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body.guild || "");
        const word = String(body.word || "");
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const r = await removeNgWord(db, guildId, word);
        return json(res, r, r.ok ? 200 : 400);
      }

      // /api/ngwords/clear
      if (pathname === "/api/ngwords/clear" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body.guild || "");
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const r = await clearNgWords(db, guildId);

        // ✅ 追加: Discord上のタイムアウトを全員分解除
        if (r.ok) {
          try {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
              const members = await guild.members.fetch();
              for (const member of members.values()) {
                if (member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
                  if (member.moderatable) {
                    await member.timeout(null, "NGワード全削除に伴う一斉解除").catch(() => { });
                  }
                }
              }
            }
          } catch (e) {
            console.error("Failed to clear timeouts for guild:", guildId, e);
          }
        }

        return json(res, r, r.ok ? 200 : 400);
      }

      // /api/settings
      if (pathname === "/api/settings") {
        const guildId = u.searchParams.get("guild") || "";
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const settings = await getSettings(guildId);
        return json(res, { ok: true, settings });
      }

      // /api/settings/update
      if (pathname === "/api/settings/update" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body.guild || "");
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const cur = await getSettings(guildId);

        const r = await updateSettings(guildId, {
          log_channel_id: cur?.log_channel_id ?? null,
          ng_threshold: Number(body.ng_threshold),
          timeout_minutes: Number(body.timeout_minutes),
        });
        return json(res, r, r.ok ? 200 : 400);
      }

      // /api/stats
      if (pathname === "/api/stats") {
        const ok = await dbReady;
        if (!ok || !db) return json(res, { ok: false, error: "db_not_ready" }, 503);

        const guildId = u.searchParams.get("guild") || "";
        const month = u.searchParams.get("month") || ""; // YYYY-MM
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        if (!/^\d{4}-\d{2}$/.test(month)) {
          return json(res, { ok: false, error: "invalid_month_format", hint: "use YYYY-MM" }, 400);
        }

        const range = tokyoMonthRangeUTC(month);
        if (!range) return json(res, { ok: false, error: "bad_month" }, 400);

        // 月次タイプ集計
        const rows = await db.all(
          `SELECT type, COUNT(*) AS cnt
           FROM log_events
           WHERE guild_id = ?
             AND ts >= ?
             AND ts < ?
           GROUP BY type`,
          [guildId, range.start, range.end]
        );

        const byType = Object.fromEntries(rows.map((r) => [r.type ?? "unknown", Number(r.cnt || 0)]));
        const ngDetected = byType.ng_detected ?? 0;
        const timeouts = (byType.timeout_applied ?? 0) + (byType.timeout ?? 0);
        const joins = byType.vc_in ?? 0;
        const leaves = byType.vc_out ?? 0;

        // Top NG Users
        const topNgRows = await db.all(
          `SELECT user_id, COUNT(*) AS cnt
           FROM log_events
           WHERE guild_id = ?
             AND ts >= ? AND ts < ?
             AND type = 'ng_detected'
             AND user_id IS NOT NULL AND user_id <> ''
           GROUP BY user_id
           ORDER BY cnt DESC
           LIMIT 10`,
          [guildId, range.start, range.end]
        );

        const guild = await client.guilds.fetch(guildId).catch(() => null);

        async function resolveParams(uid, cid) {
          const id = String(uid || "");
          const chId = String(cid || "");

          let userObj = null;
          if (id) {
            userObj = client.users.cache.get(id) || (await client.users.fetch(id).catch(() => null));
          }
          let memberObj = null;
          if (guild && id) {
            memberObj = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
          }

          let channelName = null;
          if (guild && chId) {
            const ch = guild.channels.cache.get(chId) || (await guild.channels.fetch(chId).catch(() => null));
            if (ch) channelName = ch.name;
          }

          const username = userObj?.username ?? null;
          const displayName = memberObj?.displayName ?? userObj?.globalName ?? userObj?.username ?? null;
          const avatarUrl = memberObj?.displayAvatarURL?.() ?? userObj?.displayAvatarURL?.() ?? null;

          return {
            user_id: id,
            username,
            display_name: displayName,
            avatar_url: avatarUrl,
            channel_name: channelName
          };
        }

        const resolvedUsers = await Promise.all(topNgRows.map((r) => resolveParams(r.user_id, null)));

        const topNgUsers = topNgRows.map((r, i) => ({
          user_id: String(r.user_id),
          username: resolvedUsers[i]?.username ?? null,
          display_name: resolvedUsers[i]?.display_name ?? null,
          avatar_url: resolvedUsers[i]?.avatar_url ?? null,
          cnt: Number(r.cnt || 0),
        }));

        const settings = await getSettings(guildId);
        let logChannelName = null;
        if (settings.log_channel_id) {
          const info = await resolveParams(null, settings.log_channel_id);
          logChannelName = info.channel_name;
        }

        // Check Tier for UI
        const tier = await getLicenseTierStrict(guildId);

        return json(res, {
          ok: true,
          tier,
          stats: {
            summary: { ngDetected, timeouts, joins, leaves, byType },
            topNgUsers,
            settings_info: {
              log_channel_name: logChannelName
            }
          },
        });
      }

      // /api/activity
      if (pathname === "/api/activity") {
        const guildId = u.searchParams.get("guild") || "";
        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const tier = await getLicenseTierStrict(guildId, db);
        if (!isTierAtLeast(tier, "pro")) {
          return json(res, { ok: false, error: "Upgrade to Pro" });
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return json(res, { ok: false, error: "Guild not found" }, 404);

        // Core Logic
        try {
          const data = await checkActivityStats(guild, db);
          return json(res, { ok: true, ...data });
        } catch (e) {
          return json(res, { ok: false, error: e.message });
        }
      }

      // /api/activity/download (CSV)
      if (pathname === "/api/activity/download") {
        const guildId = u.searchParams.get("guild") || "";
        const filterRole = u.searchParams.get("role") || "all";
        const filterIntro = u.searchParams.get("intro") || "all";

        const chk = await requireGuildAllowed(guildId);
        if (!chk.ok) return text(res, chk.error, chk.status);

        const tier = await getLicenseTierStrict(guildId, db);
        if (!isTierAtLeast(tier, "pro")) {
          return text(res, "Upgrade to Pro", 403);
        }

        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return text(res, "Guild not found", 404);

        try {
          let { config, data } = await checkActivityStats(guild, db);

          // Apply filters
          if (filterRole !== "all") {
            const target = filterRole === "yes" ? "Yes" : "No";
            data = data.filter(r => r.has_role === target);
          }
          if (filterIntro !== "all") {
            const target = filterIntro === "yes" ? "Yes" : "No (Recent)";
            data = data.filter(r => r.has_intro === target);
          }

          // CSV Header
          let csv = "\uFEFFUser ID,Username,DisplayName,Last VC Date,Joined At,Has Target Role,Intro Post (Recent)\n";

          data.forEach(r => {
            const row = [
              r.user_id,
              r.username,
              r.display_name,
              r.last_vc,
              r.joined_at,
              r.has_role,
              r.has_intro
            ].map(c => `"${String(c || "").replace(/"/g, '""')}"`).join(",");
            csv += row + "\n";
          });

          res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="inactive_users_filtered.csv"`
          });
          res.end(csv);
          return;
        } catch (e) {
          return text(res, "Error: " + e.message, 500);
        }
      }

      return json(res, { ok: false, error: "not_found" }, 404);
    }

    return text(res, "Not Found", 404);

  } catch (err) {
    console.error("HTTP server error:", err);
    return json(res, {
      ok: false,
      error: "internal_error",
      message: err?.message || "Internal Server Error",
    }, 500);
  }
});



server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});

/* =========================
   Discord Bot login（★必ず1回だけ）
========================= */
const discordToken =
  process.env.DISCORD_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN ||
  "";

if (!discordToken) {
  console.error("❌ Discord token is missing");
  process.exit(1);
}

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`🏠 Bot guild count: ${client.guilds.cache.size}`);

  // 初回のみ：全体同期 (少し遅延させる)
  setTimeout(async () => {
    // 1回だけグローバルコマンドを消すならコメントアウトを外して実行
    // await clearGlobalCommands(); 

    // ✅ DB接続完了を待つ (コマンド同期の正確性のため)
    await dbReady;

    console.log("🔄 Starting command sync for all guilds...");
    for (const guild of client.guilds.cache.values()) {
      const tier = await getLicenseTierStrict(guild.id, db); // DB ready check is separate, assuming ready by now
      await syncGuildCommands(guild.id, tier);
    }
    console.log("✅ Command sync completed.");
  }, 5000);
});

async function startBot() {
  const MAX_RETRIES = 5;
  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      console.log(`📡 Discord Login attempt ${i}/${MAX_RETRIES}...`);
      await client.login(discordToken);
      return;
    } catch (err) {
      console.error(`❌ Login attempt ${i} failed:`, err.message);
      if (i === MAX_RETRIES) {
        console.error("❌ Max retries reached. Exiting.");
        process.exit(1);
      }
      console.log("⏳ Retrying in 5 seconds...");
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

await startBot();
