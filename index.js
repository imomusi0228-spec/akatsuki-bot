import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

import {
  Client,
  Collection,
  GatewayIntentBits,
  Partials,
  MessageFlags,
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   Render Web Service 対策:
   ポートを開かないと落ちるので
   何もしないHTTPを立てる
========================= */
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => console.log(`🌐 Listening on ${PORT}`));

/* =========================
   Envチェック
========================= */
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");
  process.exit(1);
}

/* =========================
   Path
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================
   DB
========================= */
const db = await open({
  filename: path.join(__dirname, "data.db"),
  driver: sqlite3.Database,
});

await db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    log_channel_id TEXT
  );
`);

/* =========================
   Discord Client
========================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // メッセージ検知するなら必要
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();

/* =========================
   Commands loader (任意)
   ./commands/*.js に data/execute があれば読み込む
========================= */
const commandsDir = path.join(__dirname, "commands");
if (fs.existsSync(commandsDir)) {
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const mod = await import(path.join(commandsDir, file));
    if (mod?.data?.name && typeof mod.execute === "function") {
      client.commands.set(mod.data.name, mod);
    }
  }
}

/* =========================
   安全送信ユーティリティ
========================= */

// 「返信」したいが、元メッセージが消えていても落ちない返信
async function safeReply(message, payload) {
  try {
    // 返信先 message が partial の可能性があるので fetch を試す
    if (message.partial) {
      await message.fetch().catch(() => null);
    }
    return await message.reply(payload);
  } catch (e) {
    // Unknown message / Missing Access / etc → チャンネルへ通常送信にフォールバック
    try {
      const channel = message.channel;
      return await channel.send(payload);
    } catch (e2) {
      console.warn("⚠️ safeReply失敗:", e2?.message ?? e2);
      return null;
    }
  }
}

// 管理ログ送信（/setlog で設定されてる前提）
async function sendLog(guild, content) {
  if (!guild) return;
  const row = await db.get(
    "SELECT log_channel_id FROM settings WHERE guild_id = ?",
    guild.id
  );
  if (!row?.log_channel_id) return;

  const channel = await guild.channels.fetch(row.log_channel_id).catch(() => null);
  if (!channel) return;

  await channel.send({ content }).catch(() => null);
}

/* =========================
   起動ログ
========================= */
client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* =========================
   スラッシュコマンド実行
========================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  try {
    await cmd.execute(interaction, db);

    // 例：コマンド実行ログ
    if (interaction.guild) {
      await sendLog(
        interaction.guild,
        `🛠️ /${interaction.commandName} 実行（${interaction.user.tag}）`
      );
    }
  } catch (err) {
    console.error(err);

    const replyPayload = {
      content: "❌ 実行中にエラーが発生しました。",
      // ephemeral: true はdeprecatedになりうるので flags を使う
      flags: MessageFlags.Ephemeral,
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(replyPayload).catch(() => null);
    } else {
      await interaction.reply(replyPayload).catch(() => null);
    }
  }
});

/* =========================
   メッセージ監視（例）
   ※あなたの「不適切検出」部分で落ちてるので
   "message_reference" を手で付けない構造にする
========================= */
const NG_WORDS = [
  // 必要なら追加
  "だめ",
  "禁止",
];

client.on("messageCreate", async (message) => {
  try {
    if (message.author?.bot) return;
    if (!message.guild) return;

    const text = message.content ?? "";
    const hit = NG_WORDS.some((w) => text.includes(w));
    if (!hit) return;

    // ここが「Unknown message」で落ちがちだった箇所
    // → message_reference を手で指定せず、message.reply を使う（安全版）
    await safeReply(message, {
      content: "⚠️ 不適切な表現が検出されました。",
      allowedMentions: { repliedUser: false },
    });

    await sendLog(message.guild, `⚠️ 不適切検出: ${message.author.tag} in #${message.channel?.name ?? "unknown"}`);
  } catch (e) {
    console.warn("⚠️ messageCreate handler error:", e?.message ?? e);
  }
});

/* =========================
   メンバー参加ログ（例）
========================= */
client.on("guildMemberAdd", async (member) => {
  await sendLog(member.guild, `📥 ${member.user.tag} が参加しました`);
});

/* =========================
   ログイン
========================= */
client.login(token);
