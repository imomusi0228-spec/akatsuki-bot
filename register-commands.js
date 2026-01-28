import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REST, Routes } from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token) throw new Error("DISCORD_TOKEN が未設定です");
if (!clientId) throw new Error("CLIENT_ID が未設定です");
if (!guildId) throw new Error("GUILD_ID が未設定です（テスト用サーバーID）");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

const commands = [];
const commandsPath = path.join(__dirname, "commands");

if (!fs.existsSync(commandsPath)) {
  console.log("⚠️ commands フォルダがありません。コマンド登録をスキップします。");
  process.exit(0);
}

const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = await importFile(filePath);

  if (command?.data?.toJSON) {
    commands.push(command.data.toJSON());
  } else {
    console.warn(`⚠️ commands/${file} は data.toJSON() が無いのでスキップしました`);
  }
}

const rest = new REST({ version: "10" }).setToken(token);

await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

console.log(`✅ コマンド登録完了（Guild: ${guildId} / Commands: ${commands.length}）`);
