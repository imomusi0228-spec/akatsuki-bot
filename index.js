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
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   設定
========================= */
const DEFAULT_NG_THRESHOLD = Number(process.env.NG_THRESHOLD || 3);
const DEFAULT_TIMEOUT_MIN = Number(process.env.NG_TIMEOUT_MIN || 10);
const TIMEZONE = "Asia/Tokyo";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // 旧方式 /admin?token=...（OAuth未設定ならこれで入れる）
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const PUBLIC_URL = process.env.PUBLIC_URL || ""; // 例: https://xxxx.onrender.com
const REDIRECT_PATH = "/oauth/callback";
const OAUTH_REDIRECT_URI = PUBLIC_URL ? `${PUBLIC_URL}${REDIRECT_PATH}` : "";
const OAUTH_SCOPES = "identify guilds";

const MOVE_MERGE_WINDOW_MS = 5000;

/** ★ 429対策：ユーザーの guilds 取得は短時間キャッシュ */
const USER_GUILDS_CACHE_TTL_MS = 60_000; // 60秒（30〜120秒推奨）
/** ★ 同時取得の合流（タブ2枚/二重リクエストで429踏まない） */
const guildsInFlightBySid = new Map(); // sid -> Promise<guilds>

/* =========================
   Path
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   DB
========================= */
let db;
try {
  db = await open({
    filename: path.join(__dirname, "data.db"),
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      ng_threshold INTEGER DEFAULT ${DEFAULT_NG_THRESHOLD},
      timeout_minutes INTEGER DEFAULT ${DEFAULT_TIMEOUT_MIN}
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_words (
      guild_id TEXT,
      word TEXT,
      PRIMARY KEY (guild_id, word)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_hits (
      guild_id TEXT,
      user_id TEXT,
      count INTEGER DEFAULT 0,
      updated_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // ★ ここは後でkind付きにマイグレーションする（既存互換のため一旦旧schemaも許容）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_threads (
      guild_id TEXT,
      date_key TEXT,
      thread_id TEXT,
      PRIMARY KEY (guild_id, date_key)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_events (
      guild_id TEXT,
      type TEXT,
      user_id TEXT,
      meta TEXT,
      ts INTEGER
    );
  `);

  // ===== VC tracking =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_active (
      guild_id TEXT,
      user_id TEXT,
      channel_id TEXT,
      joined_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_stats_month (
      guild_id TEXT,
      month_key TEXT,
      user_id TEXT,
      joins INTEGER DEFAULT 0,
      total_ms INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, month_key, user_id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_stats_total (
      guild_id TEXT,
      user_id TEXT,
      joins INTEGER DEFAULT 0,
      total_ms INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_ts ON log_events (guild_id, ts);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_log_events_guild_type_ts ON log_events (guild_id, type, ts);`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_vc_month_guild_month ON vc_stats_month (guild_id, month_key);`);

  // =========================
  // ★ log_threads を kind 対応に自動マイグレーション
  //   - 旧: (guild_id, date_key) PK
  //   - 新: (guild_id, date_key, kind) PK
  // =========================
  async function migrateLogThreadsKind() {
    if (!db) return;
    try {
      const cols = await db.all(`PRAGMA table_info(log_threads);`);
      const hasKind = cols.some((c) => c.name === "kind");
      if (hasKind) return;

      // 新テーブル作成
      await db.exec(`
        CREATE TABLE IF NOT EXISTS log_threads_new (
          guild_id TEXT,
          date_key TEXT,
          kind TEXT,
          thread_id TEXT,
          PRIMARY KEY (guild_id, date_key, kind)
        );
      `);

      // 旧データを main として移行
      await db.exec(`
        INSERT OR IGNORE INTO log_threads_new (guild_id, date_key, kind, thread_id)
        SELECT guild_id, date_key, 'main' as kind, thread_id
        FROM log_threads;
      `);

      // 置き換え
      await db.exec(`DROP TABLE log_threads;`);
      await db.exec(`ALTER TABLE log_threads_new RENAME TO log_threads;`);
      console.log("✅ Migrated log_threads -> kind-aware schema");
    } catch (e) {
      console.error("❌ log_threads migration failed:", e?.message ?? e);
    }
  }
  await migrateLogThreadsKind();

  // 念のため、新schemaのlog_threadsが無い場合も作る（migration済みなら何もしない）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_threads (
      guild_id TEXT,
      date_key TEXT,
      kind TEXT,
      thread_id TEXT,
      PRIMARY KEY (guild_id, date_key, kind)
    );
  `);

  console.log("✅ DB ready");
} catch (e) {
  console.error("❌ DB init failed:", e?.message ?? e);
}

/* =========================
   Discord
========================= */
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");
}

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

/* =========================
   コマンド読み込み（commands/*.js）
========================= */
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
function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}
function normalize(s) {
  return (s ?? "").toLowerCase();
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
function msToHuman(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分${ss}秒`;
  return `${ss}秒`;
}

/** ★ 表示名を優先で返す（ニックネーム→グローバル名→username→tag） */
function displayNameFromMember(member, fallbackTag = "") {
  return (
    member?.displayName ||
    member?.user?.globalName ||
    member?.user?.username ||
    member?.user?.tag ||
    fallbackTag ||
    "Unknown"
  );
}

/** ★ 「今日 21:04」っぽいフッター文字を作る（Tokyo基準） */
function tokyoFooterTime(now = new Date()) {
  const dtfDate = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dtfTime = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const today = dtfDate.format(new Date());
  const d = dtfDate.format(now);
  const hm = dtfTime.format(now);

  if (d === today) return `今日 ${hm}`;
  return `${d} ${hm}`; // YYYY-MM-DD HH:MM
}

/** ★ VCログEmbedをスクショ風に統一 */
function buildVcEmbed({ member, userId, actionText, channelId, when = new Date() }) {
  const displayName = displayNameFromMember(member, `User(${userId})`);
  const username = member?.user?.username || member?.user?.tag || `User(${userId})`;
  const avatar = member?.user?.displayAvatarURL?.() ?? undefined;

  const chMention = channelId ? `<#${channelId}>` : "(unknown VC)";

  return new EmbedBuilder()
    .setColor(0x3498db)
    .setAuthor({ name: username, iconURL: avatar })
    // スクショっぽく： @表示名 @username left voice channel 🔊 #VC
    .setDescription(`${member ? member.toString() : `<@${userId}>`} <@${userId}> ${actionText} 🔊 ${chMention}`)
    .setFooter({ text: `ID: ${userId} · ${tokyoFooterTime(when)}` })
    .setTimestamp(when);
}

/* =========================
   日付スレッド作成/取得（kind別）
   - main: 既存ログ（VC/Join/Leaveなど）
   - ng  : NGワード検知ログ
========================= */
function threadNameByKind(kind, dateKey) {
  if (kind === "ng") return `ng-${dateKey}`;
  return `logs-${dateKey}`;
}

async function getDailyLogThread(channel, guildId, kind = "main") {
  try {
    const dateKey = todayKeyTokyo();

    const row = await db.get(
      "SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ? AND kind = ?",
      guildId,
      dateKey,
      kind
    );

    if (row?.thread_id) {
      const existing = await channel.threads.fetch(row.thread_id).catch(() => null);
      if (existing) return existing;
      await db.run("DELETE FROM log_threads WHERE guild_id = ? AND date_key = ? AND kind = ?", guildId, dateKey, kind);
    }

    if (!channel?.threads?.create) return null;

    const thread = await channel.threads.create({
      name: threadNameByKind(kind, dateKey),
      autoArchiveDuration: 1440,
      reason: `Daily log thread (${kind})`,
    });

    await db.run(
      "INSERT OR REPLACE INTO log_threads (guild_id, date_key, kind, thread_id) VALUES (?, ?, ?, ?)",
      guildId,
      dateKey,
      kind,
      thread.id
    );

    return thread;
  } catch {
    return null;
  }
}

/* =========================
   管理ログ送信（スレッド優先）
   ★ kindでスレッド分岐
========================= */
async function sendLog(guild, payload, kind = "main") {
  try {
    if (!guild || !db) return;

    const settings = await getSettings(guild.id);
    if (!settings.log_channel_id) return;

    const ch = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!ch) return;

    const thread = await getDailyLogThread(ch, guild.id, kind);
    const target = thread ?? ch;

    await target.send(payload).catch(() => null);
  } catch (e) {
    console.error("❌ sendLog error:", e?.message ?? e);
  }
}

/* =========================
   月次統計
========================= */
async function getMonthlyStats(guildId, monthStr) {
  if (!db) return null;
  const range = tokyoMonthRangeUTC(monthStr);
  if (!range) return null;

  const { start, end } = range;

  const byTypeRows = await db.all(
    `SELECT type, COUNT(*) as cnt
     FROM log_events
     WHERE guild_id = ? AND ts >= ? AND ts < ?
     GROUP BY type
     ORDER BY cnt DESC`,
    guildId,
    start,
    end
  );
  const byType = Object.fromEntries(byTypeRows.map((r) => [r.type, Number(r.cnt)]));

  const topNgUsers = await db.all(
    `SELECT user_id, COUNT(*) as cnt
     FROM log_events
     WHERE guild_id = ? AND type = 'ng_detected' AND ts >= ? AND ts < ? AND user_id IS NOT NULL
     GROUP BY user_id
     ORDER BY cnt DESC
     LIMIT 10`,
    guildId,
    start,
    end
  );

  return {
    summary: {
      ngDetected: Number(byType["ng_detected"] ?? 0),
      timeouts: Number(byType["timeout_applied"] ?? 0),
      joins: Number(byType["member_join"] ?? 0),
      leaves: Number(byType["member_leave"] ?? 0),
      byType,
    },
    topNgUsers,
  };
}

/* =========================
   VC統計（DB操作）
========================= */
async function vcStart(guildId, userId, channelId) {
  await db.run(
    `INSERT INTO vc_active (guild_id, user_id, channel_id, joined_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       joined_at = excluded.joined_at`,
    guildId,
    userId,
    channelId,
    Date.now()
  );
}
async function vcMove(guildId, userId, channelId) {
  await db.run(
    `UPDATE vc_active SET channel_id = ? WHERE guild_id = ? AND user_id = ?`,
    channelId,
    guildId,
    userId
  );
}
async function vcEnd(guildId, userId) {
  const active = await db.get(
    `SELECT channel_id, joined_at FROM vc_active WHERE guild_id = ? AND user_id = ?`,
    guildId,
    userId
  );
  await db.run(`DELETE FROM vc_active WHERE guild_id = ? AND user_id = ?`, guildId, userId);

  if (!active?.joined_at) return null;

  const durMs = Math.max(0, Date.now() - Number(active.joined_at));
  const mKey = monthKeyTokyo(new Date());

  await db.run(
    `INSERT INTO vc_stats_month (guild_id, month_key, user_id, joins, total_ms)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(guild_id, month_key, user_id) DO UPDATE SET
       joins = joins + 1,
       total_ms = total_ms + excluded.total_ms`,
    guildId,
    mKey,
    userId,
    durMs
  );

  await db.run(
    `INSERT INTO vc_stats_total (guild_id, user_id, joins, total_ms)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       joins = joins + 1,
       total_ms = total_ms + excluded.total_ms`,
    guildId,
    userId,
    durMs
  );

  const monthRow = await db.get(
    `SELECT joins, total_ms FROM vc_stats_month WHERE guild_id = ? AND month_key = ? AND user_id = ?`,
    guildId,
    mKey,
    userId
  );
  const totalRow = await db.get(
    `SELECT joins, total_ms FROM vc_stats_total WHERE guild_id = ? AND user_id = ?`,
    guildId,
    userId
  );

  return {
    channelId: active.channel_id,
    durationMs: durMs,
    monthKey: mKey,
    month: {
      joins: Number(monthRow?.joins ?? 0),
      totalMs: Number(monthRow?.total_ms ?? 0),
    },
    total: {
      joins: Number(totalRow?.joins ?? 0),
      totalMs: Number(totalRow?.total_ms ?? 0),
    },
  };
}

/* =========================
   Ready
========================= */
client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* =========================
   interactionCreate（コマンド）
========================= */
function isAlreadyAck(err) {
  return err?.code === 40060 || err?.rawError?.code === 40060;
}

// エラー時に「必ず返す」ヘルパ（ACK済み/未ACKどっちでも安全）
async function safeInteractionError(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content });
    }
    return await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;

    if (isAlreadyAck(e)) {
      try {
        return await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } catch (e2) {
        if (isUnknownInteraction(e2)) return;
      }
    }

    console.error("safeInteractionError failed:", e?.message ?? e);
  }
}

/* =========================
   NGワード検知（メッセージ監視）
========================= */
const processedMessageIds = new Map();
const DEDUPE_TTL_MS = 60_000;

function markProcessed(id) {
  const now = Date.now();
  processedMessageIds.set(id, now);
  for (const [mid, ts] of processedMessageIds) {
    if (now - ts > DEDUPE_TTL_MS) processedMessageIds.delete(mid);
  }
}
function alreadyProcessed(id) {
  const ts = processedMessageIds.get(id);
  return ts && Date.now() - ts <= DEDUPE_TTL_MS;
}

async function incrementHit(guildId, userId) {
  const now = Date.now();
  await db.run(
    `INSERT INTO ng_hits (guild_id, user_id, count, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(guild_id, user_id) DO UPDATE SET
       count = count + 1,
       updated_at = excluded.updated_at`,
    guildId,
    userId,
    now
  );
  const row = await db.get("SELECT count FROM ng_hits WHERE guild_id = ? AND user_id = ?", guildId, userId);
  return Number(row?.count ?? 1);
}

async function resetHit(guildId, userId) {
  await db.run(
    "UPDATE ng_hits SET count = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?",
    Date.now(),
    guildId,
    userId
  );
}

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (typeof message.content !== "string") return;

    if (alreadyProcessed(message.id)) return;
    markProcessed(message.id);

    const ngWords = await getNgWords(message.guildId);
    if (!ngWords.length) return;

    const contentLower = normalize(message.content);
    const hit = ngWords.find((w) => contentLower.includes(normalize(w)));
    if (!hit) return;

    const settings = await getSettings(message.guildId);

    const me = await message.guild.members.fetchMe().catch(() => null);
    const canManage = me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);
    if (canManage) await message.delete().catch(() => null);

    await message.author
      .send({
        content:
          "⚠️ サーバーのルールに抵触する可能性のある表現が検出されたため、メッセージが削除されました。\n内容を見直して再投稿してください。",
      })
      .catch(() => null);

    await logEvent(message.guildId, "ng_detected", message.author.id, {
      word: hit,
      channelId: message.channelId,
    });

    const count = await incrementHit(message.guildId, message.author.id);

    let timeoutApplied = false;
    const threshold = Math.max(1, settings.ng_threshold);
    const timeoutMin = Math.max(1, settings.timeout_minutes);

    if (count >= threshold) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const canTimeout = me?.permissions?.has(PermissionsBitField.Flags.ModerateMembers);

      if (member && canTimeout) {
        await member.timeout(timeoutMin * 60 * 1000, `NGワード検知 ${count}/${threshold}`).catch(() => null);
        timeoutApplied = true;
        await resetHit(message.guildId, message.author.id);
        await logEvent(message.guildId, "timeout_applied", message.author.id, { minutes: timeoutMin, threshold });
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xff3b3b)
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL?.() ?? undefined })
      .setTitle("🚫 NGワード検知")
      .setDescription(`Channel: ${message.channel}  |  [Jump to Message](${message.url})`)
      .addFields(
        { name: "Hit", value: `\`${hit}\``, inline: true },
        { name: "Count", value: `${Math.min(count, threshold)}/${threshold}`, inline: true },
        { name: "Content", value: `\`\`\`\n${message.content.slice(0, 1800)}\n\`\`\``, inline: false }
      )
      .setFooter({ text: timeoutApplied ? `✅ Timeout applied: ${timeoutMin} min` : `Message ID: ${message.id}` })
      .setTimestamp(new Date());

    // ★ NGログは ng スレッドへ
    await sendLog(message.guild, { embeds: [embed] }, "ng");
  } catch (e) {
    console.error("NG word monitor error:", e?.message ?? e);
  }
});

/* =========================
   IN/OUT（参加/退出）ログ（青Embed）
========================= */
client.on("guildMemberAdd", async (member) => {
  try {
    await logEvent(member.guild.id, "member_join", member.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📥 ユーザー参加")
      .setThumbnail(member.user.displayAvatarURL?.() ?? null)
      .addFields(
        { name: "User", value: `${member.user.tag}`, inline: true },
        { name: "User ID", value: `${member.user.id}`, inline: true }
      )
      .setTimestamp(new Date());

    await sendLog(member.guild, { embeds: [embed] }, "main");
  } catch (e) {
    console.error("guildMemberAdd log error:", e?.message ?? e);
  }
});

client.on("guildMemberRemove", async (member) => {
  try {
    await logEvent(member.guild.id, "member_leave", member.user.id);

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("📤 ユーザー退出")
      .setThumbnail(member.user.displayAvatarURL?.() ?? null)
      .addFields(
        { name: "User", value: `${member.user.tag}`, inline: true },
        { name: "User ID", value: `${member.user.id}`, inline: true }
      )
      .setTimestamp(new Date());

    await sendLog(member.guild, { embeds: [embed] }, "main");
  } catch (e) {
    console.error("guildMemberRemove log error:", e?.message ?? e);
  }
});

/* =========================
   ★VC MOVE まとめ（5秒以内連続は1つに）
========================= */
const moveBuffer = new Map(); // key: guildId:userId -> { userTag, pathNames:[], lastAt, timer }

function moveKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function flushMove(guild, guildId, userId) {
  const key = moveKey(guildId, userId);
  const buf = moveBuffer.get(key);
  if (!buf) return;

  clearTimeout(buf.timer);
  moveBuffer.delete(key);

  const pathNames = buf.pathNames.filter(Boolean);
  if (pathNames.length < 2) return;

  const route = pathNames.join(" → ");
  await logEvent(guildId, "vc_move_merged", userId, { route });

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("🔊 VC移動（MOVE・まとめ）")
    .setDescription(`ユーザー: **${buf.userTag}**`)
    .addFields(
      { name: "Route", value: route.slice(0, 1000), inline: false },
      { name: "Moves", value: `${pathNames.length - 1}回`, inline: true },
      { name: "Window", value: `≤ ${Math.floor(MOVE_MERGE_WINDOW_MS / 1000)}秒`, inline: true }
    )
    .setTimestamp(new Date());

  await sendLog(guild, { embeds: [embed] }, "main");
}

function queueMove(guild, guildId, userId, userTag, fromName, toName) {
  const key = moveKey(guildId, userId);
  const now = Date.now();
  const existing = moveBuffer.get(key);

  if (!existing) {
    const obj = {
      userTag,
      pathNames: [fromName, toName],
      lastAt: now,
      timer: null,
    };
    obj.timer = setTimeout(() => flushMove(guild, guildId, userId), MOVE_MERGE_WINDOW_MS);
    moveBuffer.set(key, obj);
    return;
  }

  if (now - existing.lastAt <= MOVE_MERGE_WINDOW_MS) {
    existing.userTag = userTag;
    const last = existing.pathNames[existing.pathNames.length - 1];
    if (last !== toName) existing.pathNames.push(toName);
    existing.lastAt = now;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushMove(guild, guildId, userId), MOVE_MERGE_WINDOW_MS);
    return;
  }

  flushMove(guild, guildId, userId).catch(() => null);

  const obj = {
    userTag,
    pathNames: [fromName, toName],
    lastAt: now,
    timer: null,
  };
  obj.timer = setTimeout(() => flushMove(guild, guildId, userId), MOVE_MERGE_WINDOW_MS);
  moveBuffer.set(key, obj);
}

/* =========================
   ★VCログ：IN/MOVE/OUT（青Embed）
   ★ IN/OUTは表示名（ニックネーム）で出す
========================= */
async function logEvent(guildId, type, userId = null, metaObj = null) {
  try {
    if (!db) return;
    const meta = metaObj ? JSON.stringify(metaObj) : null;
    await db.run(
      "INSERT INTO log_events (guild_id, type, user_id, meta, ts) VALUES (?, ?, ?, ?, ?)",
      guildId,
      type,
      userId,
      meta,
      Date.now()
    );
  } catch {}
}

client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild || !db) return;

    const userId = newState.id || oldState.id;
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    const member = await guild.members.fetch(userId).catch(() => null);

    // IN
    if (!oldCh && newCh) {
      await flushMove(guild, guild.id, userId).catch(() => null);

      await vcStart(guild.id, userId, newCh);

      await logEvent(guild.id, "vc_join", userId, {
        channelId: newCh,
        channelName: newState.channel?.name ?? null,
      });

      const embed = buildVcEmbed({
        member,
        userId,
        actionText: "joined voice channel",
        channelId: newCh,
        when: new Date(),
      });

      await sendLog(guild, { embeds: [embed] }, "main");
      return;
    }

    // MOVE（まとめ）
    if (oldCh && newCh && oldCh !== newCh) {
      await vcMove(guild.id, userId, newCh);

      const fromName = oldState.channel?.name ?? `#${oldCh}`;
      const toName = newState.channel?.name ?? `#${newCh}`;

      // moveまとめは既存通り（ログはまとめ後に出る）
      const displayName = displayNameFromMember(member, member?.user?.tag ?? `User(${userId})`);
      queueMove(guild, guild.id, userId, displayName, fromName, toName);
      return;
    }

    // OUT
    if (oldCh && !newCh) {
      await flushMove(guild, guild.id, userId).catch(() => null);

      const result = await vcEnd(guild.id, userId);
      if (!result) return;

      await logEvent(guild.id, "vc_session_end", userId, {
        durationMs: result.durationMs,
        channelId: result.channelId,
        channelName: oldState.channel?.name ?? null,
      });

      const embed = buildVcEmbed({
        member,
        userId,
        actionText: "left voice channel",
        channelId: result.channelId,
        when: new Date(),
      });

      await sendLog(guild, { embeds: [embed] }, "main");
    }
  } catch (e) {
    console.error("voiceStateUpdate error:", e?.message ?? e);
  }
});

/* =========================
   Web: Discord OAuth セッション
========================= */
const sessions = new Map(); // sid -> { accessToken, user, guilds, guildsFetchedAt, expiresAt }
const states = new Map(); // state -> createdAt

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
function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}
function rand(n = 24) {
  return crypto.randomBytes(n).toString("hex");
}

/** ★ Discord API：429はRetry-After尊重でバックオフ（header/JSON両対応） */
async function discordApi(
  accessToken,
  apiPath,
  method = "GET",
  body = null,
  extraHeaders = null,
  maxRetries = 4
) {
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
      const text = await r.text().catch(() => "");
      return text ? JSON.parse(text) : null;
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
          if (typeof data?.retry_after === "number") {
            waitMs = Math.ceil(data.retry_after * 1000);
          }
        } catch {}
      }

      waitMs += 250 + Math.floor(Math.random() * 250);

      if (attempt === maxRetries) {
        throw new Error(`Discord API ${apiPath} failed: 429 (rate limited)`);
      }

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
    const p = BigInt(permStr || "0");
    const ADMINISTRATOR = 1n << 3n; // 0x8
    const MANAGE_GUILD = 1n << 5n; // 0x20
    return (p & ADMINISTRATOR) !== 0n || (p & MANAGE_GUILD) !== 0n;
  } catch {
    return false;
  }
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

/** ★ 429の主因：/users/@me/guilds を「短時間キャッシュ + 同時合流 + 失敗時は古いキャッシュ」 */
async function ensureGuildsForSession(s) {
  const now = Date.now();

  if (
    s.guilds &&
    Array.isArray(s.guilds) &&
    s.guildsFetchedAt &&
    now - s.guildsFetchedAt < USER_GUILDS_CACHE_TTL_MS
  ) {
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
      if (s.guilds && Array.isArray(s.guilds) && s.guilds.length > 0) {
        return s.guilds;
      }
      throw e;
    }
  })().finally(() => {
    guildsInFlightBySid.delete(s.sid);
  });

  guildsInFlightBySid.set(s.sid, p);
  return await p;
}

function botGuilds() {
  return client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
}
function intersectUserBotGuilds(userGuilds) {
  const botSet = new Set(client.guilds.cache.map((g) => g.id));
  return (userGuilds || [])
    .filter((g) => botSet.has(g.id))
    .filter((g) => hasAdminPerm(g.permissions))
    .map((g) => ({ id: g.id, name: g.name, owner: !!g.owner, permissions: g.permissions }));
}

/* =========================
   Web server: admin + API + OAuth
========================= */
const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", baseUrl(req));
    const pathname = u.pathname;

    // health (Render check)
    if (pathname === "/health") return text(res, "ok", 200);

    // ---- 旧token方式（OAuthが無い場合の保険）----
    const tokenQ = u.searchParams.get("token") || "";
    const tokenAuthed = ADMIN_TOKEN && tokenQ === ADMIN_TOKEN;

    // ---- OAuth session ----
    const sess = await getSession(req);
    const oauthReady = !!(CLIENT_ID && CLIENT_SECRET && (PUBLIC_URL || req.headers.host));
    const isAuthed = !!sess || tokenAuthed;

    // ====== OAuth endpoints ======
    if (pathname === "/login") {
      if (!oauthReady) return text(res, "OAuth not configured. Set DISCORD_CLIENT_ID/SECRET and PUBLIC_URL.", 500);

      const state = rand(18);
      states.set(state, Date.now());
      for (const [k, t] of states) if (Date.now() - t > 10 * 60_000) states.delete(k);

      const redirectUri = OAUTH_REDIRECT_URI || `${baseUrl(req)}${REDIRECT_PATH}`;
      const authorize = new URL("https://discord.com/oauth2/authorize");
      authorize.searchParams.set("client_id", CLIENT_ID);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("redirect_uri", redirectUri);
      authorize.searchParams.set("scope", OAUTH_SCOPES);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("prompt", "none");

      res.writeHead(302, { Location: authorize.toString() });
      return res.end();
    }

    if (pathname === REDIRECT_PATH) {
      if (!oauthReady) return text(res, "OAuth is not configured.", 500);

      const code = u.searchParams.get("code") || "";
      const state = u.searchParams.get("state") || "";
      const created = states.get(state);
      if (!code || !state || !created) return text(res, "Invalid OAuth state/code", 400);
      states.delete(state);

      const redirectUri = OAUTH_REDIRECT_URI || `${baseUrl(req)}${REDIRECT_PATH}`;

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

      const accessToken = tok.access_token;
      const expiresIn = Number(tok.expires_in || 3600);

      const user = await discordApi(accessToken, "/users/@me");
      const sid = rand(24);

      sessions.set(sid, {
        accessToken,
        user,
        guilds: null,
        guildsFetchedAt: 0,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      setCookie(res, "sid", sid, { maxAge: expiresIn });
      res.writeHead(302, { Location: "/admin" });
      return res.end();
    }

    if (pathname === "/logout") {
      if (sess?.sid) sessions.delete(sess.sid);
      delCookie(res, "sid");
      res.writeHead(302, { Location: "/" });
      return res.end();
    }

    // ====== Pages ======
    if (pathname === "/") {
      return html(res, renderHomeHTML({ oauthReady, isAuthed, botGuilds: botGuilds().length }));
    }

    if (pathname === "/admin") {
      if (!isAuthed) {
        return html(res, renderNeedLoginHTML({ oauthReady, tokenEnabled: !!ADMIN_TOKEN }));
      }
      const user = sess?.user || null;
      return html(res, renderAdminHTML({ user, oauth: !!sess, tokenAuthed }));
    }

    // ====== APIs ======
    if (pathname.startsWith("/api/")) {
      if (!isAuthed) return json(res, { ok: false, error: "unauthorized" }, 401);

      // OAuth時は「Bot入り + あなたが管理権限のある鯖」だけ許可
      let allowedGuildIds = null;
      if (sess) {
        const userGuilds = await ensureGuildsForSession(sess);
        const allowed = intersectUserBotGuilds(userGuilds);
        allowedGuildIds = new Set(allowed.map((g) => g.id));
      }

      function requireGuildAllowed(guildId) {
        if (!guildId) return { ok: false, status: 400, error: "missing guild" };
        if (allowedGuildIds && !allowedGuildIds.has(guildId)) {
          return { ok: false, status: 403, error: "forbidden guild" };
        }
        return { ok: true };
      }

      if (pathname === "/api/health") return json(res, { ok: true });

      if (pathname === "/api/me") {
        return json(res, {
          ok: true,
          oauth: !!sess,
          user: sess?.user
            ? { id: sess.user.id, username: sess.user.username, global_name: sess.user.global_name }
            : null,
          botGuildCount: client.guilds.cache.size,
        });
      }

      if (pathname === "/api/guilds") {
        if (sess) {
          const userGuilds = await ensureGuildsForSession(sess);
          const list = intersectUserBotGuilds(userGuilds).map((g) => ({ id: g.id, name: g.name }));
          return json(res, { ok: true, guilds: list });
        }
        // token方式はbotが入ってる鯖一覧（制限なし）
        return json(res, { ok: true, guilds: botGuilds() });
      }

      if (pathname === "/api/settings") {
        const guildId = u.searchParams.get("guild") || "";
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const s = await getSettings(guildId);
        return json(res, { ok: true, guildId, settings: s });
      }

      if (pathname === "/api/ngwords") {
        const guildId = u.searchParams.get("guild") || "";
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const words = await getNgWords(guildId);
        return json(res, { ok: true, guildId, count: words.length, words });
      }

      if (pathname === "/api/stats") {
        const guildId = u.searchParams.get("guild") || "";
        const month = u.searchParams.get("month") || "";
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);
        if (!month) return json(res, { ok: false, error: "missing month" }, 400);

        const stats = await getMonthlyStats(guildId, month);
        return json(res, { ok: true, guildId, month, stats });
      }

      if (pathname === "/api/ngwords/add" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const word = String(body?.word || "");
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const r = await addNgWord(guildId, word);
        const words = await getNgWords(guildId);
        return json(res, { ok: !!r.ok, error: r.error || null, count: words.length, words });
      }

      if (pathname === "/api/ngwords/remove" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const word = String(body?.word || "");
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const r = await removeNgWord(guildId, word);
        const words = await getNgWords(guildId);
        return json(res, { ok: !!r.ok, error: r.error || null, count: words.length, words });
      }

      if (pathname === "/api/ngwords/clear" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        await clearNgWords(guildId);
        const words = await getNgWords(guildId);
        return json(res, { ok: true, count: words.length, words });
      }

      if (pathname === "/api/settings/update" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const chk = requireGuildAllowed(guildId);
        if (!chk.ok) return json(res, { ok: false, error: chk.error }, chk.status);

        const next = await updateSettings(guildId, {
          ng_threshold: body?.ng_threshold,
          timeout_minutes: body?.timeout_minutes,
        });
        return json(res, { ok: true, settings: next });
      }

      return json(res, { ok: false, error: "not found" }, 404);
    }

    return text(res, "Not Found", 404);
  } catch (e) {
    console.error("web error:", e?.message ?? e);
    return text(res, "500", 500);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Listening on ${PORT}`);
});

/* =========================
   Login
========================= */
if (token) {
  client.login(token).catch((e) => console.error("❌ login failed:", e?.message ?? e));
} else {
  console.error("❌ DISCORD_TOKEN が無いのでログインできません");
}

/* =========================
   Web helpers
========================= */
function json(res, obj, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function text(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}
function html(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
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
   Pages
========================= */
function renderHomeHTML({ oauthReady, isAuthed, botGuilds }) {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Akatsuki Bot</title>
<style>
body{font-family:system-ui;margin:16px}
.card{border:1px solid #ddd;border-radius:12px;padding:12px;max-width:820px}
.btn{display:inline-block;padding:10px 12px;border:1px solid #333;border-radius:10px;text-decoration:none;color:#000}
.muted{color:#666}
</style></head>
<body>
  <div class="card">
    <h2>Akatsuki Bot</h2>
    <p class="muted">Botが入っているサーバー数: ${botGuilds}</p>
    ${
      isAuthed
        ? `<a class="btn" href="/admin">管理画面へ</a> <a class="btn" href="/logout">ログアウト</a>`
        : oauthReady
          ? `<a class="btn" href="/login">Discordでログイン</a>`
          : `<p class="muted">OAuth未設定（DISCORD_CLIENT_ID/SECRET + PUBLIC_URL を設定してください）</p>`
    }
  </div>
</body></html>`;
}

function renderNeedLoginHTML({ oauthReady, tokenEnabled }) {
  return `<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Login</title>
<style>
body{font-family:system-ui;margin:16px}
.card{border:1px solid #ddd;border-radius:12px;padding:12px;max-width:820px}
.btn{display:inline-block;padding:10px 12px;border:1px solid #333;border-radius:10px;text-decoration:none;color:#000}
.muted{color:#666}
</style></head>
<body>
  <div class="card">
    <h2>管理画面</h2>
    <p class="muted">Discord OAuthでログインしてください。</p>
    ${
      oauthReady
        ? `<a class="btn" href="/login">Discordでログイン</a>`
        : `<p class="muted">OAuth未設定（DISCORD_CLIENT_ID/SECRET + PUBLIC_URL が必要）</p>`
    }
    ${
      tokenEnabled
        ? `<hr/><p class="muted">（保険）ADMIN_TOKEN方式: /admin?token=XXXX</p>`
        : ``
    }
  </div>
</body></html>`;
}

/* =========================
   ★管理画面（設定表示をわかりやすく）
========================= */
function renderAdminHTML({ user, oauth, tokenAuthed }) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Akatsuki Bot Admin</title>
<style>
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:12px; }
  select,input,button { padding:8px; }
  button { cursor:pointer; }
  .card { border:1px solid #ddd; border-radius:12px; padding:12px; margin:12px 0; }
  .grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(320px,1fr)); gap:12px; }
  pre { white-space:pre-wrap; word-break:break-word; }
  .muted { color:#666; }
  table { width:100%; border-collapse:collapse; }
  th,td { border-bottom:1px solid #eee; padding:8px; text-align:left; }
  .pill{display:inline-block;padding:4px 8px;border:1px solid #ccc;border-radius:999px;font-size:12px}
</style>
</head>
<body>
  <h2>Akatsuki Bot 管理画面</h2>
  <div class="row">
    <span class="pill">${oauth ? "Discord OAuth" : "Token"} でログイン中</span>
    ${user ? `<span class="pill">User: ${user.global_name || user.username}</span>` : ``}
    ${oauth ? `<a href="/logout">ログアウト</a>` : ``}
  </div>

  <div class="card">
    <div class="row">
      <label>あなたが管理できる鯖（Bot導入済み）:</label>
      <select id="guild"></select>
      <label>Month:</label>
      <input id="month" type="month" />
      <button id="reload">更新</button>
    </div>
    <p class="muted">※「あなたが所属」かつ「Botが入ってる」かつ「管理権限(Manage Guild / Admin)」の鯖だけ出ます。</p>
  </div>

  <div class="grid">
    <div class="card">
      <h3>月次サマリ</h3>
      <div id="summary">読み込み中...</div>
    </div>

    <div class="card">
      <h3>Top NG Users</h3>
      <table>
        <thead><tr><th>User ID</th><th>Count</th></tr></thead>
        <tbody id="topNg"></tbody>
      </table>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>NGワード一覧（管理者のみ）</h3>
      <pre id="ngwords">(loading)</pre>
      <div class="row">
        <input id="ng_add" placeholder="追加するワード" />
        <button id="btn_add">追加</button>
      </div>
      <div class="row">
        <input id="ng_remove" placeholder="削除するワード（完全一致）" />
        <button id="btn_remove">削除</button>
      </div>
      <div class="row">
        <button id="btn_clear" style="border:1px solid #f00;">全削除</button>
        <span class="muted">※戻せません</span>
      </div>
    </div>

    <div class="card">
      <h3>NG検知の自動処分（わかりやすく）</h3>
      <div id="settingsBox" class="muted">読み込み中...</div>

      <div class="row" style="margin-top:10px;">
        <label>何回でタイムアウト？</label>
        <input id="threshold" type="number" min="1" step="1" />
        <label>タイムアウト時間（分）</label>
        <input id="timeout" type="number" min="1" step="1" />
        <button id="btn_save">保存</button>
      </div>
      <p class="muted">例：3回で10分タイムアウト</p>
    </div>
  </div>

<script>
(() => {
  const $ = (id) => document.getElementById(id);

  function yyyymmNow(){
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    return \`\${y}-\${m}\`;
  }

  async function api(path, opts){
    const r = await fetch(path, opts);
    return r.json();
  }

  async function postJson(path, body){
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  // ★ 2重ロード防止（429踏み防止）
  let loading = false;

  async function loadGuilds(){
    const data = await api("/api/guilds");
    const sel = $("guild");
    sel.innerHTML = "";
    (data.guilds || []).forEach(g => {
      const opt = document.createElement("option");
      opt.value = g.id;
      opt.textContent = \`\${g.name} (\${g.id})\`;
      sel.appendChild(opt);
    });
  }

  function card(label, value){
    return \`
      <div style="border:1px solid #eee;border-radius:12px;padding:10px;">
        <div style="color:#666;font-size:12px;">\${label}</div>
        <div style="font-size:22px;font-weight:700;">\${value}</div>
      </div>
    \`;
  }

  function renderByTypeTable(obj){
    const keys = Object.keys(obj || {});
    if (!keys.length) return \`<div class="muted">（今月のイベントはまだありません）</div>\`;

    const rows = keys
      .sort((a,b)=> (obj[b]??0)-(obj[a]??0))
      .map(k => \`<tr><td>\${k}</td><td>\${obj[k]}</td></tr>\`)
      .join("");

    return \`
      <table>
        <thead><tr><th>type</th><th>count</th></tr></thead>
        <tbody>\${rows}</tbody>
      </table>
    \`;
  }

  function renderSettingsBox(s){
    const logCh = s.log_channel_id ? s.log_channel_id : "未設定（/setlog で設定）";
    return \`
      <table>
        <tbody>
          <tr><td style="width:220px;">管理ログ チャンネルID</td><td><b>\${logCh}</b></td></tr>
          <tr><td>NG検知 → タイムアウトまで</td><td><b>\${s.ng_threshold} 回</b></td></tr>
          <tr><td>タイムアウト時間</td><td><b>\${s.timeout_minutes} 分</b></td></tr>
        </tbody>
      </table>
    \`;
  }

  async function reload(){
    if (loading) return;
    loading = true;
    try {
      const guildId = $("guild").value;
      const month = $("month").value;
      if (!guildId || !month) return;

      const stats = await api(\`/api/stats?guild=\${encodeURIComponent(guildId)}&month=\${encodeURIComponent(month)}\`);
      const summary = stats.stats?.summary ?? {};
      const byType = summary.byType ?? {};

      $("summary").innerHTML = \`
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:10px;">
          \${card("NG検知", summary.ngDetected ?? 0)}
          \${card("Timeout", summary.timeouts ?? 0)}
          \${card("Join", summary.joins ?? 0)}
          \${card("Leave", summary.leaves ?? 0)}
        </div>
        <div style="font-weight:600;margin:6px 0;">内訳（byType）</div>
        \${renderByTypeTable(byType)}
      \`;

      const topNg = $("topNg");
      topNg.innerHTML = "";
      (stats.stats?.topNgUsers || []).forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = \`<td>\${r.user_id}</td><td>\${r.cnt}</td>\`;
        topNg.appendChild(tr);
      });

      const ng = await api(\`/api/ngwords?guild=\${encodeURIComponent(guildId)}\`);
      $("ngwords").textContent = (ng.words || []).join("\\n") || "(empty)";

      const st = await api(\`/api/settings?guild=\${encodeURIComponent(guildId)}\`);
      $("settingsBox").innerHTML = renderSettingsBox(st.settings ?? { log_channel_id:null, ng_threshold:3, timeout_minutes:10 });
      $("threshold").value = st.settings?.ng_threshold ?? 3;
      $("timeout").value = st.settings?.timeout_minutes ?? 10;
    } finally {
      loading = false;
    }
  }

  $("reload").addEventListener("click", reload);
  $("guild").addEventListener("change", reload);
  $("month").addEventListener("change", reload);

  $("btn_add").addEventListener("click", async () => {
    const guildId = $("guild").value;
    const word = $("ng_add").value;
    await postJson("/api/ngwords/add", { guild: guildId, word });
    $("ng_add").value = "";
    await reload();
  });

  $("btn_remove").addEventListener("click", async () => {
    const guildId = $("guild").value;
    const word = $("ng_remove").value;
    await postJson("/api/ngwords/remove", { guild: guildId, word });
    $("ng_remove").value = "";
    await reload();
  });

  $("btn_clear").addEventListener("click", async () => {
    if (!confirm("NGワードを全削除します。よろしいですか？")) return;
    const guildId = $("guild").value;
    await postJson("/api/ngwords/clear", { guild: guildId });
    await reload();
  });

  $("btn_save").addEventListener("click", async () => {
    const guildId = $("guild").value;
    const ng_threshold = Number($("threshold").value);
    const timeout_minutes = Number($("timeout").value);
    await postJson("/api/settings/update", { guild: guildId, ng_threshold, timeout_minutes });
    await reload();
    alert("保存しました");
  });

  (async () => {
    $("month").value = yyyymmNow();
    await loadGuilds();
    await reload();
  })();
})();
</script>
</body>
</html>`;
}
