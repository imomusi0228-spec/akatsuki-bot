import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REST, Routes } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) throw new Error("DISCORD_TOKEN が未設定です");
if (!CLIENT_ID) throw new Error("DISCORD_CLIENT_ID が未設定です");
if (!GUILD_ID) throw new Error("GUILD_ID が未設定です（Guildコマンド登録に必要）");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCommandJson() {
  const commands = [];
  const used = new Set();

  const commandsDir = path.join(__dirname, "commands");
  const files = fs.readdirSync(commandsDir).filter((f) => f.endsWith(".js"));

  for (const file of files) {
    // deploy系は登録対象外
    if (file.includes("deploy-commands")) continue;

    const filePath = path.join(commandsDir, file);
    const fileUrl = pathToFileURL(filePath).href;

    const mod = await import(fileUrl);
    const cmd = mod.default ?? mod;
    const data = cmd?.data ?? mod?.data;

    if (!data?.toJSON) continue;

    const json = data.toJSON();
    if (used.has(json.name)) {
      console.warn(`⚠️ duplicate command skipped: ${json.name} (${file})`);
      continue;
    }
    used.add(json.name);
    commands.push(json);
  }

  // ★重要：/admin は index.js で処理するので、commandsに無い場合だけ追加したい
  // ただし今回 duplicate が出ているので「adminは既にcommands側にある」想定で追加しない

  return commands;
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

console.log("🚀 Deploying guild commands...");
const commands = await loadCommandJson();

// 既存を全削除 → 登録（確実に反映）
console.log("🧹 既存Guildコマンドを全削除中...");
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });

console.log("📥 新しいコマンドを登録中...");
await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });

console.log("✅ commands registered (guild)");
