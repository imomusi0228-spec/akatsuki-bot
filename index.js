import http from "node:http";

// ★最優先：Renderのポートスキャン対策（ここが最初）
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
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   Envチェック
========================= */
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");
}

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
      log_channel_id TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ng_words (
      guild_id TEXT,
      word TEXT,
      PRIMARY KEY (guild_id, word)
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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
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

async function getNgWords(guildId) {
  if (!db) return [];
  const rows = await db.all("SELECT word FROM ng_words WHERE guild_id = ?", guildId);
  return rows.map((r) => (r.word ?? "").trim()).filter(Boolean);
}

/* =========================
   管理ログ送信 helper（文字列/Embed 両対応）
========================= */
async function sendLog(guild, payload) {
  try {
    if (!guild || !db) return;

    const row = await db.get(
      "SELECT log_channel_id FROM settings WHERE guild_id = ?",
      guild.id
    );
    if (!row?.log_channel_id) return;

    const ch = await guild.channels.fetch(row.log_channel_id).catch(() => null);
    if (!ch) return;

    if (typeof payload === "string") {
      await ch.send({ content: payload }).catch(() => null);
    } else {
      await ch.send(payload).catch(() => null);
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

// interactionCreate（10062対策込み）
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, db);

    if (interaction.guild) {
      await sendLog(
        interaction.guild,
        `🛠️ /${interaction.commandName} が実行されました（実行者: ${interaction.user.tag}）`
      );
    }
  } catch (err) {
    console.error(err);

    // 二重起動やデプロイ直後の競合で起きる。無視でOK
    if (isUnknownInteraction(err)) return;

    const payload = { content: `❌ エラー: ${err?.message ?? err}`, ephemeral: true };

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (e) {
      if (!isUnknownInteraction(e)) console.error("reply failed:", e);
    }
  }
});

/* ===== NGワード検知（メッセージ監視） ===== */

// 二重処理防止（同一プロセス内）
const processedMessageIds = new Map(); // id -> timestamp(ms)
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

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (typeof message.content !== "string") return;

    // 二重通知対策（同一プロセス内）
    if (alreadyProcessed(message.id)) return;
    markProcessed(message.id);

    const ngWords = await getNgWords(message.guildId);
    if (!ngWords.length) return;

    const contentLower = normalize(message.content);
    const hit = ngWords.find((w) => contentLower.includes(normalize(w)));
    if (!hit) return;

    // 削除（権限があれば）
    const me = await message.guild.members.fetchMe().catch(() => null);
    const canManage =
      me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);

    if (canManage) {
      await message.delete().catch(() => null);
    }

    // 参加者には見せない：本人DMのみ（ヒット語は見せない）
    const dmText =
      `⚠️ サーバーのルールに抵触する可能性のある表現が検出されたため、メッセージが削除されました。\n` +
      `内容を見直して再投稿してください。`;
    await message.author.send({ content: dmText }).catch(() => null);

    // 管理ログ：赤色Embed
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
        { name: "User ID", value: `${message.author.id}`, inline: true },
        {
          name: "Content",
          value: `\`\`\`\n${message.content.slice(0, 1800)}\n\`\`\``,
          inline: false,
        }
      )
      .setFooter({ text: `Message ID: ${message.id}` })
      .setTimestamp(new Date());

    await sendLog(message.guild, { embeds: [embed] });
  } catch (e) {
    console.error("NG word monitor error:", e?.message ?? e);
  }
});

// INログ（参加）: 青色Embed
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

// OUTログ（退出）: 青色Embed
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
