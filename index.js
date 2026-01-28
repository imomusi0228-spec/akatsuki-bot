import http from "node:http";
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
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""; // 管理画面の鍵（必須）

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
  // VCに入った瞬間の状態（アクティブセッション）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_active (
      guild_id TEXT,
      user_id TEXT,
      channel_id TEXT,
      joined_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // VCの月別統計（joins=参加回数, total_ms=累計滞在ms）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vc_stats_month (
      guild_id TEXT,
      month_key TEXT, -- YYYY-MM (Tokyo 기준)
      user_id TEXT,
      joins INTEGER DEFAULT 0,
      total_ms INTEGER DEFAULT 0,
      PRIMARY KEY (guild_id, month_key, user_id)
    );
  `);

  // VCの累計統計（全期間）
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
if (!token) console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates, // ★VC統計に必要
  ],
});

client.commands = new Collection();

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

/* =========================
   コマンド読み込み
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
  // Tokyo UTC+9
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
   VC統計
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
  // 移動は「同じセッション扱い」：開始時刻は維持しつつチャンネルだけ更新
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

  // month
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

  // total
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

  await logEvent(guildId, "vc_session_end", userId, { durationMs: durMs });

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
    joinedAt: Number(active.joined_at),
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

async function getVcTop(guildId, monthKey, limit = 20) {
  const rows = await db.all(
    `SELECT user_id, joins, total_ms
     FROM vc_stats_month
     WHERE guild_id = ? AND month_key = ?
     ORDER BY total_ms DESC
     LIMIT ?`,
    guildId,
    monthKey,
    limit
  );
  return rows.map((r) => ({
    user_id: r.user_id,
    joins: Number(r.joins ?? 0),
    total_ms: Number(r.total_ms ?? 0),
  }));
}

/* =========================
   @タグ（名前の@以降）人数統計
========================= */
function extractTagsFromDisplayName(displayName) {
  const s = String(displayName || "");
  const at = s.indexOf("@");
  if (at === -1) return [];
  const tail = s.slice(at + 1).trim();
  if (!tail) return [];
  // スペース区切りで tags: Mana Gaia Meteor Elemental
  return tail.split(/\s+/).map((x) => x.trim()).filter(Boolean);
}

async function getTagCounts(guild) {
  // 正確に出すために全メンバーFetch（権限と人数によって時間かかることはある）
  const members = await guild.members.fetch().catch(() => null);
  const list = members ? Array.from(members.values()) : Array.from(guild.members.cache.values());

  const counts = new Map();
  let scanned = 0;

  for (const m of list) {
    scanned++;
    const tags = extractTagsFromDisplayName(m.displayName);
    for (const t of tags) counts.set(t, (counts.get(t) || 0) + 1);
  }

  // ソートして返す
  const arr = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return { scanned, tags: arr };
}

/* =========================
   Discord Events
========================= */
client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ★コマンド実行ログは送らない
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

/* ===== NGワード検知（メッセージ監視） ===== */
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
  await db.run("UPDATE ng_hits SET count = 0, updated_at = ? WHERE guild_id = ? AND user_id = ?", Date.now(), guildId, userId);
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

    // 削除（権限があれば）
    const me = await message.guild.members.fetchMe().catch(() => null);
    const canManage = me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);
    if (canManage) await message.delete().catch(() => null);

    // 本人DM（ヒット語は見せない）
    await message.author.send({
      content:
        "⚠️ サーバーのルールに抵触する可能性のある表現が検出されたため、メッセージが削除されました。\n内容を見直して再投稿してください。",
    }).catch(() => null);

    // 統計用イベント
    await logEvent(message.guildId, "ng_detected", message.author.id, { word: hit, channelId: message.channelId });

    // 検知回数
    const count = await incrementHit(message.guildId, message.author.id);

    // タイムアウト判定
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

    // 管理ログ（赤Embed）
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

// IN/OUT（青Embed）
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

/* ===== VC参加/退出ログ（青Embed）＋統計 ===== */
client.on("voiceStateUpdate", async (oldState, newState) => {
  try {
    const guild = newState.guild || oldState.guild;
    if (!guild || !db) return;

    const userId = newState.id || oldState.id;
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    // 参加
    if (!oldCh && newCh) {
      await vcStart(guild.id, userId, newCh);
      await logEvent(guild.id, "vc_join", userId, { channelId: newCh });
      return;
    }

    // 移動（セッション継続）
    if (oldCh && newCh && oldCh !== newCh) {
      await vcMove(guild.id, userId, newCh);
      await logEvent(guild.id, "vc_move", userId, { from: oldCh, to: newCh });
      return;
    }

    // 退出
    if (oldCh && !newCh) {
      const result = await vcEnd(guild.id, userId);
      if (!result) return;

      const member = await guild.members.fetch(userId).catch(() => null);
      const name = member?.user?.tag ?? `User(${userId})`;

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔊 VC退出")
        .setDescription(`ユーザー: **${name}**`)
        .addFields(
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
   Web server: admin + API
========================= */
const PORT = Number(process.env.PORT || 3000);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // auth
    const t = url.searchParams.get("token") || "";
    const authed = ADMIN_TOKEN && t === ADMIN_TOKEN;

    if (pathname === "/admin") {
      if (!authed) return text(res, "401 Unauthorized", 401);
      return html(res, renderAdminHTML());
    }

    if (pathname.startsWith("/api/")) {
      if (!authed) return json(res, { ok: false, error: "unauthorized" }, 401);

      if (pathname === "/api/health") return json(res, { ok: true });

      if (pathname === "/api/guilds") {
        const list = client?.guilds?.cache?.map((g) => ({ id: g.id, name: g.name })) ?? [];
        return json(res, { ok: true, guilds: list });
      }

      if (pathname === "/api/settings") {
        const guildId = url.searchParams.get("guild") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const s = await getSettings(guildId);
        return json(res, { ok: true, guildId, settings: s });
      }

      if (pathname === "/api/ngwords") {
        const guildId = url.searchParams.get("guild") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const words = await getNgWords(guildId);
        return json(res, { ok: true, guildId, count: words.length, words });
      }

      if (pathname === "/api/stats") {
        const guildId = url.searchParams.get("guild") || "";
        const month = url.searchParams.get("month") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        if (!month) return json(res, { ok: false, error: "missing month" }, 400);
        const stats = await getMonthlyStats(guildId, month);
        return json(res, { ok: true, guildId, month, stats });
      }

      // ===== VC API =====
      if (pathname === "/api/vc/top") {
        const guildId = url.searchParams.get("guild") || "";
        const month = url.searchParams.get("month") || monthKeyTokyo(new Date());
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const top = await getVcTop(guildId, month, 20);
        return json(res, { ok: true, guildId, month, top });
      }

      // ===== Tag counts API =====
      if (pathname === "/api/tags") {
        const guildId = url.searchParams.get("guild") || "";
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) return json(res, { ok: false, error: "guild not found" }, 404);

        const data = await getTagCounts(guild);
        return json(res, { ok: true, guildId, scanned: data.scanned, tags: data.tags });
      }

      // ===== POST edit API =====
      if (pathname === "/api/ngwords/add" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const word = String(body?.word || "");
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const r = await addNgWord(guildId, word);
        const words = await getNgWords(guildId);
        return json(res, { ok: !!r.ok, error: r.error || null, count: words.length, words });
      }

      if (pathname === "/api/ngwords/remove" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        const word = String(body?.word || "");
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        const r = await removeNgWord(guildId, word);
        const words = await getNgWords(guildId);
        return json(res, { ok: !!r.ok, error: r.error || null, count: words.length, words });
      }

      if (pathname === "/api/ngwords/clear" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);
        await clearNgWords(guildId);
        const words = await getNgWords(guildId);
        return json(res, { ok: true, count: words.length, words });
      }

      if (pathname === "/api/settings/update" && req.method === "POST") {
        const body = await readJson(req);
        const guildId = String(body?.guild || "");
        if (!guildId) return json(res, { ok: false, error: "missing guild" }, 400);

        const next = await updateSettings(guildId, {
          ng_threshold: body?.ng_threshold,
          timeout_minutes: body?.timeout_minutes,
        });
        return json(res, { ok: true, settings: next });
      }

      return json(res, { ok: false, error: "not found" }, 404);
    }

    return text(res, "OK", 200);
  } catch {
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
  try { return JSON.parse(raw); } catch { return {}; }
}

/* =========================
   Admin HTML（円グラフ付き）
========================= */
function renderAdminHTML() {
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
    canvas { width:100%; max-width:520px; height:auto; }
    .pill { display:inline-block; padding:2px 8px; border:1px solid #ddd; border-radius:999px; margin:2px 6px 2px 0; }
  </style>
</head>
<body>
  <h2>Akatsuki Bot 管理画面</h2>
  <p class="muted">URLに token が必要です（/admin?token=...）</p>

  <div class="card">
    <div class="row">
      <label>Guild:</label>
      <select id="guild"></select>
      <label>Month:</label>
      <input id="month" type="month" />
      <button id="reload">更新</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>月次サマリ（既存）</h3>
      <pre id="summary">読み込み中...</pre>
    </div>

    <div class="card">
      <h3>Top NG Users（既存）</h3>
      <table>
        <thead><tr><th>User ID</th><th>Count</th></tr></thead>
        <tbody id="topNg"></tbody>
      </table>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>VC 統計（今月 Top）</h3>
      <table>
        <thead><tr><th>User ID</th><th>参加回数</th><th>合計</th></tr></thead>
        <tbody id="topVc"></tbody>
      </table>
      <p class="muted">※退出ログはDiscordの管理ログ(日付スレッド)にも出ます</p>
    </div>

    <div class="card">
      <h3>@タグ人数（円グラフ）</h3>
      <canvas id="pie" width="520" height="320"></canvas>
      <div id="legend"></div>
      <pre id="tagsRaw" class="muted"></pre>
      <p class="muted">表示名の「@以降」をスペース区切りでタグとして集計します（例: @Mana Gaia Meteor Elemental）</p>
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
      <h3>NG検知の自動処分</h3>
      <div class="row">
        <label>閾値（回）</label>
        <input id="threshold" type="number" min="1" step="1" />
        <label>タイムアウト（分）</label>
        <input id="timeout" type="number" min="1" step="1" />
        <button id="btn_save">保存</button>
      </div>
      <pre id="settings">(loading)</pre>
    </div>
  </div>

<script>
(() => {
  const token = new URL(location.href).searchParams.get("token") || "";
  const $ = (id) => document.getElementById(id);

  function yyyymmNow(){
    const dt = new Date();
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    return \`\${y}-\${m}\`;
  }

  async function api(path, opts){
    const u = new URL(path, location.origin);
    u.searchParams.set("token", token);
    const r = await fetch(u, opts);
    return r.json();
  }

  async function postJson(path, body){
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function msToHuman(ms){
    const s = Math.max(0, Math.floor(ms/1000));
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const ss = s%60;
    if (h>0) return \`\${h}時間\${m}分\`;
    if (m>0) return \`\${m}分\${ss}秒\`;
    return \`\${ss}秒\`;
  }

  function drawPie(canvas, items){
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);

    const total = items.reduce((a,b)=>a+b.count,0) || 1;
    const cx = 170, cy = 160, r = 120;

    let start = -Math.PI/2;
    const colors = [
      "#4E79A7","#F28E2B","#E15759","#76B7B2","#59A14F","#EDC948","#B07AA1","#FF9DA7","#9C755F","#BAB0AC"
    ];

    items.forEach((it, i)=>{
      const frac = it.count/total;
      const end = start + frac*2*Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx,cy);
      ctx.arc(cx,cy,r,start,end);
      ctx.closePath();
      ctx.fillStyle = colors[i%colors.length];
      ctx.fill();

      // label line (optional small)
      start = end;
    });

    // donut hole
    ctx.beginPath();
    ctx.arc(cx,cy,55,0,2*Math.PI);
    ctx.fillStyle = "#fff";
    ctx.fill();

    // total text
    ctx.fillStyle = "#111";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("TOTAL", cx, cy-6);
    ctx.font = "16px system-ui";
    ctx.fillText(String(total), cx, cy+16);

    // legend
    const legend = $("legend");
    legend.innerHTML = "";
    items.slice(0, 12).forEach((it,i)=>{
      const span = document.createElement("span");
      span.className = "pill";
      span.style.borderColor = colors[i%colors.length];
      span.textContent = \`\${it.tag}: \${it.count}\`;
      legend.appendChild(span);
    });
  }

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

  async function reload(){
    const guildId = $("guild").value;
    const month = $("month").value;
    if (!guildId || !month) return;

    // monthly stats
    const stats = await api(\`/api/stats?guild=\${encodeURIComponent(guildId)}&month=\${encodeURIComponent(month)}\`);
    $("summary").textContent = JSON.stringify(stats.stats?.summary ?? {}, null, 2);

    const topNg = $("topNg");
    topNg.innerHTML = "";
    (stats.stats?.topNgUsers || []).forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`<td>\${r.user_id}</td><td>\${r.cnt}</td>\`;
      topNg.appendChild(tr);
    });

    // ngwords
    const ng = await api(\`/api/ngwords?guild=\${encodeURIComponent(guildId)}\`);
    $("ngwords").textContent = (ng.words || []).join("\\n") || "(empty)";

    // settings
    const st = await api(\`/api/settings?guild=\${encodeURIComponent(guildId)}\`);
    $("settings").textContent = JSON.stringify(st.settings ?? {}, null, 2);
    $("threshold").value = st.settings?.ng_threshold ?? 3;
    $("timeout").value = st.settings?.timeout_minutes ?? 10;

    // vc top
    const vc = await api(\`/api/vc/top?guild=\${encodeURIComponent(guildId)}&month=\${encodeURIComponent(month)}\`);
    const topVc = $("topVc");
    topVc.innerHTML = "";
    (vc.top || []).forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML = \`<td>\${r.user_id}</td><td>\${r.joins}</td><td>\${msToHuman(r.total_ms)}</td>\`;
      topVc.appendChild(tr);
    });

    // tags
    const tag = await api(\`/api/tags?guild=\${encodeURIComponent(guildId)}\`);
    const items = (tag.tags || []).slice(0, 12);
    drawPie($("pie"), items);
    $("tagsRaw").textContent = JSON.stringify({ scanned: tag.scanned, tags: tag.tags }, null, 2);
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

/* =========================
   Start
========================= */
