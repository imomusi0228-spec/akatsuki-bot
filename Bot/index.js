import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Collection, GatewayIntentBits } from "discord.js";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- DB ---
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

// --- Discord Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // 参加ログ等に必要
  ],
});

client.commands = new Collection();

// --- コマンド読み込み ---
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = await import(filePath);
  client.commands.set(command.data.name, command);
}

// --- ログ送信 helper ---
async function sendLog(guild, message) {
  const row = await db.get("SELECT log_channel_id FROM settings WHERE guild_id = ?", guild.id);
  if (!row?.log_channel_id) return;

  const channel = await guild.channels.fetch(row.log_channel_id).catch(() => null);
  if (!channel) return;

  channel.send(message).catch(() => null);
}

// --- Events ---
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction, db);
    await sendLog(interaction.guild, `🛠️ /${interaction.commandName} が実行されました（実行者: ${interaction.user.tag}）`);
  } catch (err) {
    console.error(err);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({ content: "❌ 実行中にエラーが発生しました", ephemeral: true }).catch(() => null);
    } else {
      await interaction.reply({ content: "❌ 実行中にエラーが発生しました", ephemeral: true }).catch(() => null);
    }
  }
});

// 例：参加ログ
client.on("guildMemberAdd", async member => {
  await sendLog(member.guild, `📥 ${member.user.tag} が参加しました`);
});

client.login(token);
