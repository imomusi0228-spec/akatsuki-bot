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

async function getSettings(guildId) {
  if (!db) {
    return {
      log_channel_id: null,
      ng_threshold: DEFAULT_NG_THRESHOLD,
      timeout_minutes: DEFAULT_TIMEOUT_MIN,
    };
  }

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES (?, NULL, ?, ?)
     ON CONFLICT(guild_id) DO NOTHING`,
    guildId,
    DEFAULT_NG_THRESHOLD,
    DEFAULT_TIMEOUT_MIN
  );

  const row = await db.get(
    "SELECT log_channel_id, ng_threshold, timeout_minutes FROM settings WHERE guild_id = ?",
    guildId
  );

  return {
    log_channel_id: row?.log_channel_id ?? null,
    ng_threshold: Number(row?.ng_threshold ?? DEFAULT_NG_THRESHOLD),
    timeout_minutes: Number(row?.timeout_minutes ?? DEFAULT_TIMEOUT_MIN),
  };
}

async function updateSettings(guildId, patch) {
  const cur = await getSettings(guildId);
  const next = {
    log_channel_id: patch.log_channel_id ?? cur.log_channel_id,
    ng_threshold: Number.isFinite(Number(patch.ng_threshold)) ? Number(patch.ng_threshold) : cur.ng_threshold,
    timeout_minutes: Number.isFinite(Number(patch.timeout_minutes)) ? Number(patch.timeout_minutes) : cur.timeout_minutes,
  };
  next.ng_threshold = Math.max(1, next.ng_threshold);
  next.timeout_minutes = Math.max(1, next.timeout_minutes);

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       log_channel_id = excluded.log_channel_id,
       ng_threshold = excluded.ng_threshold,
       timeout_minutes = excluded.timeout_minutes`,
    guildId,
    next.log_channel_id,
    next.ng_threshold,
    next.timeout_minutes
  );

  return await getSettings(guildId);
}

async function getNgWords(guildId) {
  if (!db) return [];
  const rows = await db.all("SELECT word FROM ng_words WHERE guild_id = ? ORDER BY word ASC", guildId);
  return rows.map((r) => (r.word ?? "").trim()).filter(Boolean);
}
async function addNgWord(guildId, word) {
  const w = (word ?? "").trim();
  if (!w) return { ok: false, error: "empty" };
  await db.run(`INSERT OR IGNORE INTO ng_words (guild_id, word) VALUES (?, ?)`, guildId, w);
  return { ok: true };
}
async function removeNgWord(guildId, word) {
  const w = (word ?? "").trim();
  if (!w) return { ok: false, error: "empty" };
  await db.run(`DELETE FROM ng_words WHERE guild_id = ? AND word = ?`, guildId, w);
  return { ok: true };
}
async function clearNgWords(guildId) {
  await db.run(`DELETE FROM ng_words WHERE guild_id = ?`, guildId);
  return { ok: true };
}

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

/* =========================
   日付スレッド作成/取得
========================= */
async function getDailyLogThread(channel, guildId) {
  try {
    const dateKey = todayKeyTokyo();

    const row = await db.get(
      "SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ?",
      guildId,
      dateKey
    );
    if (row?.thread_id) {
      const existing = await channel.threads.fetch(row.thread_id).catch(() => null);
      if (existing) return existing;
      await db.run("DELETE FROM log_threads WHERE guild_id = ? AND date_key = ?", guildId, dateKey);
    }

    if (!channel?.threads?.create) return null;

    const thread = await channel.threads.create({
      name: `logs-${dateKey}`,
      autoArchiveDuration: 1440,
      reason: "Daily log thread",
    });

    await db.run(
      "INSERT OR REPLACE INTO log_threads (guild_id, date_key, thread_id) VALUES (?, ?, ?)",
      guildId,
      dateKey,
      thread.id
    );

    return thread;
  } catch {
    return null;
  }
}

/* =========================
   管理ログ送信（スレッド優先）
========================= */
async function sendLog(guild, payload) {
  try {
    if (!guild || !db) return;

    const settings = await getSettings(guild.id);
    if (!settings.log_channel_id) return;

    const ch = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!ch) return;

    const thread = await getDailyLogThread(ch, guild.id);
    const target = thread ?? ch;

    await target.send(payload).catch(() => null);
  } catch (e) {
    console.error("❌ sendLog error:", e?.message ?? e);
  }
}

/* =========================
   月次統計（既存）
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
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, db);
  } catch (err) {
    console.error(err);
    if (isUnknownInteraction(err)) return;

    const payload = { content: `❌ エラー: ${err?.message ?? err}`, ephemeral: true };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (e) {
      if (!isUnknownInteraction(e)) console.error("reply failed:", e?.message ?? e);
    }
  }
});

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

    await logEvent(message.guildId, "ng_detected", message.author.id, { word: hit, channelId: message.channelId });

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

    await sendLog(message.guild, { embeds: [embed] });
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

    await sendLog(member.guild, { embeds: [embed] });
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

    await sendLog(member.guild, { embeds: [embed] });
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

  // pathNames: [from, to, to, ...] みたいになるので、整形
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

  await sendLog(guild, { embeds: [embed] });
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

  // 5秒以内なら合流
  if (now - existing.lastAt <= MOVE_MERGE_WINDOW_MS) {
    existing.userTag = userTag;
    // 直前が同じなら詰める
    const last = existing.pathNames[existing.pathNames.length - 1];
    if (last !== toName) existing.pathNames.push(toName);
    existing.lastAt = now;
    clearTimeout(existing.timer);
    existing.timer = setTimeout(() => flushMove(guild, guildId, userId), MOVE_MERGE_WINDOW_MS);
    return;
  }

  // 5秒越えたらいったん吐いて、新規
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
========================= */
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild || !db) return;

    const userId = newState.id || oldState.id;
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    const member = await guild.members.fetch(userId).catch(() => null);
    const userTag = member?.user?.tag ?? `User(${userId})`;

    // 参加（IN）
    if (!oldCh && newCh) {
      // もし直前にMOVEまとめが残っていたら吐く
      await flushMove(guild, guild.id, userId).catch(() => null);

      await vcStart(guild.id, userId, newCh);

      const chName = newState.channel?.name ?? `#${newCh}`;
      await logEvent(guild.id, "vc_join", userId, { channelId: newCh, channelName: newState.channel?.name ?? null });

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔊 VC参加（IN）")
        .setDescription(`ユーザー: **${userTag}**`)
        .addFields({ name: "VC", value: chName, inline: true })
        .setTimestamp(new Date());

      await sendLog(guild, { embeds: [embed] });
      return;
    }

    // 移動（MOVE）→ 5秒まとめ
    if (oldCh && newCh && oldCh !== newCh) {
      await vcMove(guild.id, userId, newCh);

      const fromName = oldState.channel?.name ?? `#${oldCh}`;
      const toName = newState.channel?.name ?? `#${newCh}`;

      queueMove(guild, guild.id, userId, userTag, fromName, toName);
      return;
    }

    // 退出（OUT）
    if (oldCh && !newCh) {
      // OUT前に、溜まってるMOVEまとめがあれば先に吐く
      await flushMove(guild, guild.id, userId).catch(() => null);

      const result = await vcEnd(guild.id, userId);
      if (!result) return;

      const chName = oldState.channel?.name ?? `#${result.channelId}`;

      await logEvent(guild.id, "vc_session_end", userId, {
        durationMs: result.durationMs,
        channelId: result.channelId,
        channelName: oldState.channel?.name ?? null,
      });

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔊 VC退出（OUT）")
        .setDescription(`ユーザー: **${userTag}**`)
        .addFields(
          { name: "VC", value: chName, inline: true },
          { name: "今回の滞在", value: msToHuman(result.durationMs), inline: true },
          { name: `今月(${result.monthKey}) 参加回数`, value: `${result.month.joins}回`, inline: true },
          { name: `今月(${result.monthKey}) 合計`, value: msToHuman(result.month.totalMs), inline: true },
          { name: "累計 参加回数", value: `${result.total.joins}回`, inline: true },
          { name: "累計 合計", value: msToHuman(result.total.totalMs), inline: true }
        )
        .setTimestamp(new Date());

      await sendLog(guild, { embeds: [embed] });
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
  raw.split(";").map(s => s.trim()).filter(Boolean).forEach(pair => {
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

/** ★ Discord API：429はRetry-After尊重でバックオフ */
async function discordApi(accessToken, path, method = "GET", body = null, extraHeaders = null, maxRetries = 3) {
  const url = `https://discord.com/api/v10${path}`;
  let attempt = 0;

  while (true) {
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
      // 204などbody無しもあるので安全に読む
      const text = await r.text().catch(() => "");
      return text ? JSON.parse(text) : null;
    }

    // 429: Retry-Afterを必ず待つ
    if (r.status === 429) {
      const retryAfter = r.headers.get("retry-after");
      const waitMs = (retryAfter ? Number(retryAfter) * 1000 : 1000) + Math.floor(Math.random() * 250);
      attempt++;
      if (attempt > maxRetries) {
        const msg = await r.text().catch(() => "");
        throw new Error(`Discord API ${path} failed: 429 (too many). ${msg}`);
      }
      await new Promise((res) => setTimeout(res, waitMs));
      continue;
    }

    const msg = await r.text().catch(() => "");
    throw new Error(`Discord API ${path} failed: ${r.status} ${msg}`);
  }
}

function hasAdminPerm(permStr) {
  // /users/@me/guilds の permissions は文字列のbitset
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

/** ★ ここが429の主因：/users/@me/guilds を「短時間キャッシュ + 同時合流」 */
async function ensureGuildsForSession(s) {
  const now = Date.now();

  // キャッシュが新しければ返す
  if (s.guilds && Array.isArray(s.guilds) && s.guildsFetchedAt && (now - s.guildsFetchedAt) < USER_GUILDS_CACHE_TTL_MS) {
    return s.guilds;
  }

  // 同じsidで既に取りに行ってたら、それに乗る（合流）
  const inflight = guildsInFlightBySid.get(s.sid);
  if (inflight) {
    const guilds = await inflight;
    return guilds;
  }

  const p = (async () => {
    const guilds = await discordApi(s.accessToken, "/users/@me/guilds");
    // セッションへキャッシュ保存
    const raw = sessions.get(s.sid);
    if (raw) {
      raw.guilds = guilds;
      raw.guildsFetchedAt = Date.now();
      sessions.set(s.sid, raw);
    }
    return guilds;
  })().finally(() => {
    guildsInFlightBySid.delete(s.sid);
  });

  guildsInFlightBySid.set(s.sid, p);
  return await p;
}

function botGuilds() {
  return client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
}
function intersectUserBotGuilds(userGuilds) {
  const botSet = new Set(client.guilds.cache.map(g => g.id));
  return (userGuilds || [])
    .filter(g => botSet.has(g.id))
    .filter(g => hasAdminPerm(g.permissions))
    .map(g => ({ id: g.id, name: g.name, owner: !!g.owner, permissions: g.permissions }));
}

/* =========================
   Web server: admin + API + OAuth
========================= */
const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", baseUrl(req));
    const pathname = u.pathname;

    // ---- 旧token方式（OAuthが無い場合の保険）----
    const tokenQ = u.searchParams.get("token") || "";
    const tokenAuthed = ADMIN_TOKEN && tokenQ === ADMIN_TOKEN;

    // ---- OAuth session ----
    const sess = await getSession(req);
    const oauthReady = !!(CLIENT_ID && CLIENT_SECRET && (PUBLIC_URL || req.headers.host));
    const isAuthed = !!sess || tokenAuthed;

    // ====== OAuth endpoints ======
    if (pathname === "/login") {
      if (!oauthReady) return text(res, "OAuth is not configured. Set DISCORD_CLIENT_ID/SECRET and PUBLIC_URL.", 500);

      const state = rand(18);
      states.set(state, Date.now());
      // 古いstate掃除
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
        // OAuthが使えるならログイン誘導、無いならtoken方式案内
        return html(res, renderNeedLoginHTML({ oauthReady, tokenEnabled: !!ADMIN_TOKEN }));
      }
      const user = sess?.user || null;
      return html(res, renderAdminHTML({ user, oauth: !!sess, tokenAuthed }));
    }

    // ====== APIs ======
    if (pathname.startsWith("/api/")) {
