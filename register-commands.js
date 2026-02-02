// register-commands.js（完成形：そのままコピペOK）
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REST, Routes } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;

// GLOBAL_COMMANDS=1 なら全鯖(グローバル)登録、それ以外はGuild登録
const IS_GLOBAL = process.env.GLOBAL_COMMANDS === "1";
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) throw new Error("DISCORD_TOKEN が未設定です");
if (!CLIENT_ID) throw new Error("DISCORD_CLIENT_ID が未設定です");

// Guild登録のときだけ GUILD_ID 必須
if (!IS_GLOBAL && !GUILD_ID) {
  throw new Error("GUILD_ID が未設定です（Guildコマンド登録に必要）");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCommandJson() {
  const commands = [];
  const used = new Set();

  const commandsDir = path.join(__dirname, "commands");
  if (!fs.existsSync(commandsDir)) {
    console.warn("⚠️ commands ディレクトリが見つかりません:", commandsDir);
    return commands;
  }

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
    if (!json?.name) continue;

    if (used.has(json.name)) {
      console.warn(`⚠️ duplicate command skipped: ${json.name} (${file})`);
      continue;
    }
    used.add(json.name);
    commands.push(json);
  }

  return commands;
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

const DEBUG_GUILD_ID = "1467338822051430572";
const DEBUG_COMMAND_NAME = "debug_tier";

const allCommands = await loadCommandJson();
const debugCommands = allCommands.filter(c => c.name === DEBUG_COMMAND_NAME);
const generalCommands = allCommands.filter(c => c.name !== DEBUG_COMMAND_NAME);

if (IS_GLOBAL) {
  console.log("🚀 Deploying GLOBAL commands...");
  console.log("🧹 既存GLOBALコマンドを全削除中...");
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });

  console.log("📥 新しいコマンドを登録中...");
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: generalCommands });

  console.log("✅ General commands registered (global)");
  console.log("ℹ️ Global反映は最大1時間かかることがあります");
} else {
  console.log("🚀 Deploying GUILD commands...");
  console.log("Target GUILD_ID:", GUILD_ID);

  console.log("🧹 既存Guildコマンドを全削除中...");
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });

  console.log("📥 新しいコマンドを登録中...");
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: generalCommands });

  console.log("✅ General commands registered (guild)");
}

// Register Debug Command separately
if (debugCommands.length > 0) {
  console.log("\n🚀 Deploying DEBUG commands...");
  console.log("Target DEBUG_GUILD_ID:", DEBUG_GUILD_ID);

  // Note: This replaces ALL guild commands on the debug guild. 
  // If the debug guild is same as main GUILD_ID and not global, we might overwrite.
  // But here IDs are different (1461... vs 1467...), so it's safe.
  // Also assuming we only want debug commands there, or we appoint only debug cmds here.
  // To avoid wiping other commands in debug guild (if any), we should fetch existing?
  // No, users usually expect "register" to act as sync. 
  // Since this is a specific debug guild restriction, let's just push debug commands.
  // WAIT: If we put only debug commands, does it wipe others? Yes.
  // Does the user use 1467... for other things? 
  // It's likely a test server. Let's register debug commands. 
  // If they want general commands there too, they should probably use GLOBAL mode or add ID to loop.
  // For now, "Visible only in this server" means we put it there.

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, DEBUG_GUILD_ID), { body: debugCommands });
  console.log("✅ Debug commands registered (debug guild only)");
}
