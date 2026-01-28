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
if (!guildId) throw new Error("GUILD_ID が未設定です");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function importFile(filePath) {
  return import(pathToFileURL(filePath).href);
}

// commands読み込み
const commands = [];
const commandsPath = path.join(__dirname, "commands");

if (fs.existsSync(commandsPath)) {
  const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    const filePath = path.join(commandsPath, file);
    const mod = await importFile(filePath);
    if (mod?.data?.toJSON) commands.push(mod.data.toJSON());
  }
}

const rest = new REST({ version: "10" }).setToken(token);

try {
  console.log("🧹 既存コマンドを全削除（グローバル）...");
  await rest.put(Routes.applicationCommands(clientId), { body: [] });

  console.log("🧹 既存コマンドを全削除（Guild）...");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [] });

  console.log("📥 新しいコマンドを登録（Guild）...");
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

  console.log(`✅ コマンド再登録完了（Guild Commands: ${commands.length}）`);
} catch (e) {
  console.error("❌ register failed:", e?.message ?? e);
  console.error(e);
  process.exit(1);
}
