import http from "node:http";

// ★Renderのポートスキャン対策（最初）
const PORT = Number(process.env.PORT || 3000);
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Listening on ${PORT}`);
  });

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
  ChannelType,
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   設定（必要ならここだけ変える）
========================= */
const DEFAULT_NG_THRESHOLD = Number(process.env.NG_THRESHOLD || 3); // 何回で
const DEFAULT_TIMEOUT_MIN = Number(process.env.NG_TIMEOUT_MIN || 10); // 何分タイムアウト
const TIMEZONE = "Asia/Tokyo";

/* =========================
   Envチェック
========================= */
const token = process.env.DISCORD_TOKEN;
if (!token) console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");

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

  // ログ設定 + NG設定（閾値/タイムアウト）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      guild_id TEXT PRIMARY KEY,
      log_channel_id TEXT,
      ng_threshold INTEGER DEFAULT ${DEFAULT_NG_THRESHOLD},
      timeout_minutes INTEGER DEFAULT ${DEFAULT_TIMEOUT_MIN}
    );
  `);

  // NGワード
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_words (
      guild_id TEXT,
      word TEXT,
      PRIMARY KEY (guild_id, word)
    );
  `);

  // NG検知回数（ユーザーごと）
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_hits (
      guild_id TEXT,
      user_id TEXT,
      count INTEGER DEFAULT 0,
      updated_at INTEGER,
      PRIMARY KEY (guild_id, user_id)
    );
  `);

  // 日付スレッド管理
  await db.exec(`
    CREATE TABLE IF NOT EXISTS log_threads (
      guild_id TEXT,
      date_key TEXT,
      thread_id TEXT,
      PRIMARY KEY (guild_id, date_key)
    );
  `);
} catch (e) {
  console.error("❌ DB init failed:", e?.message ?? e);
}

/* =========================
   Discord Client
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,     // timeout / IN-OUT
    GatewayIntentBits.GuildMessages,    // NG検知
    GatewayIntentBits.MessageContent,   // NG本文
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

      // commands/*.js が export const data / export async function execute の形ならOK
      if (mod?.data?.name && typeof mod.execute === "function") {
        client.commands.set(mod.data.name, mod);
      } else {
        console.warn(`⚠️ commands/${file} は data/execute が無いのでスキップしました`);
      }
    }
  } else {
    console.warn("⚠️ commands フォルダが見つかりません");
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
  // YYYY-MM-DD in Asia/Tokyo
  const dtf = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return dtf.format(new Date()); // sv-SE => 2026-01-29
}

async function getSettings(guildId) {
  if (!db) return { log_channel_id: null, ng_threshold: DEFAULT_NG_THRESHOLD, timeout_minutes: DEFAULT_TIMEOUT_MIN };

  // 行が無ければデフォルトで作っておく（setlogより先にNG検知が来てもOK）
  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id, ng_threshold, timeout_minutes)
     VALUES (?, NULL, ?, ?)
     ON CONFLICT(guild_id) DO NOTHING`,
    guildId,
    DEFAULT_NG_THRESHOLD,
    DEFAULT_TIMEOUT_MIN
  );

  const row = await db.get("SELECT log_channel_id, ng_threshold, timeout_minutes FROM settings WHERE guild_id = ?", guildId);
  return {
    log_channel_id: row?.log_channel_id ?? null,
    ng_threshold: Number(row?.ng_threshold ?? DEFAULT_NG_THRESHOLD),
    timeout_minutes: Number(row?.timeout_minutes ?? DEFAULT_TIMEOUT_MIN),
  };
}

async function getNgWords(guildId) {
  if (!db) return [];
  const rows = await db.all("SELECT word FROM ng_words WHERE guild_id = ?", guildId);
  return rows.map((r) => (r.word ?? "").trim()).filter(Boolean);
}

/* =========================
   日付ごとスレッド作成/取得
========================= */
async function getDailyLogThread(channel, guildId) {
  try {
    const dateKey = todayKeyTokyo();

    // 既にDBにあるならそれを使う
    const row = await db.get(
      "SELECT thread_id FROM log_threads WHERE guild_id = ? AND date_key = ?",
      guildId,
      dateKey
    );
    if (row?.thread_id) {
      const existing = await channel.threads.fetch(row.thread_id).catch(() => null);
      if (existing) return existing;
      // 消されてたらDBから消す
      await db.run(
        "DELETE FROM log_threads WHERE guild_id = ? AND date_key = ?",
        guildId,
        dateKey
      );
    }

    // チャンネルがスレッド作成に対応していないなら諦める
    if (!channel?.threads?.create) return null;

    // スレッド作成（logs-YYYY-MM-DD）
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
   管理ログ送信 helper（スレッド優先）
========================= */
async function sendLog(guild, payload) {
  try {
    if (!guild || !db) return;

    const settings = await getSettings(guild.id);
    if (!settings.log_channel_id) return;

    const ch = await guild.channels.fetch(settings.log_channel_id).catch(() => null);
    if (!ch) return;

    // 日付スレッドが作れたらそっちへ、無理ならチャンネルへ
    const thread = await getDailyLogThread(ch, guild.id);
    const target = thread ?? ch;

    if (typeof payload === "string") {
      await target.send({ content: payload }).catch(() => null);
    } else {
      await target.send(payload).catch(() => null);
    }
  } catch (e) {
    console.error("❌ sendLog error:", e?.message ?? e);
  }
}

/* =========================
   Events
========================= */
client.once("clientReady", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ★コマンド実行ログは送らない（要望対応）
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

// 同一プロセス内の二重処理防止
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
    const canManage =
      me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);

    if (canManage) await message.delete().catch(() => null);

    // 本人にDM（ワード内容は見せない）
    const dmText =
      `⚠️ サーバーのルールに抵触する可能性のある表現が検出されたため、メッセージが削除されました。\n` +
      `内容を見直して再投稿してください。`;
    await message.author.send({ content: dmText }).catch(() => null);

    // 検知回数カウント
    const count = await incrementHit(message.guildId, message.author.id);

    // タイムアウト判定
    let timeoutApplied = false;
    const threshold = Math.max(1, settings.ng_threshold);
    const timeoutMin = Math.max(1, settings.timeout_minutes);

    if (count >= threshold) {
      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member) {
        // 権限があるか
        const canTimeout = me?.permissions.has(PermissionsBitField.Flags.ModerateMembers);
        if (canTimeout) {
          const ms = timeoutMin * 60 * 1000;
          await member.timeout(ms, `NGワード検知 ${count}/${threshold}`).catch(() => null);
          timeoutApplied = true;
          // 一度タイムアウトしたらカウントはリセット（連続タイムアウト防止）
          await resetHit(message.guildId, message.author.id);
        }
      }
    }

    // 管理ログ：赤Embed（NG）
    const embed = new EmbedBuilder()
      .setColor(0xff3b3b)
      .setAuthor({
        name: message.author.tag,
        iconURL: message.author.displayAvatarURL?.() ?? undefined,
      })
      .setTitle("🚫 NGワード検知")
      .setDescription(`Channel: ${message.channel}  |  [Jump to Message](${message.url})`)
      .addFields(
        { name: "Hit", value: `\`${hit}\``, inline: true },
        { name: "Count", value: `${Math.min(count, threshold)}/${threshold}`, inline: true },
        {
          name: "Content",
          value: `\`\`\`\n${message.content.slice(0, 1800)}\n\`\`\``,
          inline: false,
        }
      )
      .setFooter({
        text: timeoutApplied
          ? `✅ Timeout applied: ${timeoutMin} min`
          : `Message ID: ${message.id}`,
      })
      .setTimestamp(new Date());

    await sendLog(message.guild, { embeds: [embed] });
  } catch (e) {
    console.error("NG word monitor error:", e?.message ?? e);
  }
});

// INログ（参加）: 青Embed
client.on("guildMemberAdd", async (member) => {
  try {
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

// OUTログ（退出）: 青Embed
client.on("guildMemberRemove", async (member) => {
  try {
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
   Login
========================= */
if (token) {
  client.login(token).catch((e) => console.error("❌ login failed:", e?.message ?? e));
} else {
  console.error("❌ DISCORD_TOKEN が無いのでログインできません");
}
