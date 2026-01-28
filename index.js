import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Client,
  Collection,
  GatewayIntentBits,
  MessageFlags,
} from "discord.js";

import sqlite3 from "sqlite3";
import { open } from "sqlite";

/* =========================
   Render(Web Service)対策:
   ポートが無いと落ちるので
   ダミーHTTPを立てる
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
  ],
});

client.commands = new Collection();

/* =========================
   Windows対応：動的importは必ず file:// URL にする
========================= */
async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

/* =========================
   コマンド読み込み（./commands/*.js）
========================= */
const commandsPath = path.join(__dirname, "commands");

if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = await importFile(filePath);

    if (command?.data?.name && typeof command.execute === "function") {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`⚠️ commands/${file} は data/execute が無いのでスキップしました`);
    }
  }
} else {
  console.warn("⚠️ commands フォルダが見つかりません（スラッシュコマンド無しで起動します）");
}

/* =========================
   管理ログ送信 helper
   settings(guild_id, log_channel_id) に保存された先へ送る
========================= */
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
   Events
========================= */
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

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

    const payload = {
      content: "❌ 実行中にエラーが発生しました",
      flags: MessageFlags.Ephemeral, // ephemeral警告回避
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

// 例：参加ログ
client.on("guildMemberAdd", async (member) => {
  await sendLog(member.guild, `📥 ${member.user.tag} が参加しました`);
});

client.login(token);
