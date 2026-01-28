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

// ここから下で落ちても、ポートは開いたままになる

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  Client,
  Collection,
  GatewayIntentBits,
  MessageFlags,
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
  // Renderで落とすとポートが閉じるので、process.exitはしない
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
      }
    }
  }
} catch (e) {
  console.error("❌ Command load failed:", e?.message ?? e);
}

/* =========================
   管理ログ送信 helper
========================= */
async function sendLog(guild, content) {
  try {
    if (!guild || !db) return;
    const row = await db.get(
      "SELECT log_channel_id FROM settings WHERE guild_id = ?",
      guild.id
    );
    if (!row?.log_channel_id) return;

    const ch = await guild.channels.fetch(row.log_channel_id).catch(() => null);
    if (!ch) return;

    await ch.send({ content }).catch(() => null);
  } catch {}
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
      content: `❌ エラー: ${err?.message ?? err}`,
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

// NGワード検知
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;
    if (typeof message.content !== "string") return;

    const ngWords = await getNgWords(message.guildId);
    if (!ngWords.length) return;

    const content = normalize(message.content);
    const hit = ngWords.find((w) => content.includes(normalize(w)));
    if (!hit) return;

    // 削除権限チェック
    const me = await message.guild.members.fetchMe().catch(() => null);
    const canManage =
      me?.permissionsIn(message.channel)?.has(PermissionsBitField.Flags.ManageMessages);

    if (canManage) {
      await message.delete().catch(() => null);
    }

    await message.channel
      .send({
        content: `⚠️ ${message.author} 不適切な表現が検出されました（ワード: \`${hit}\`）。`,
      })
      .catch(() => null);

    await sendLog(
      message.guild,
      `🚫 NGワード検知: ${message.author.tag} / #${message.channel?.name}\nワード: "${hit}"\n内容: "${message.content}"`
    );
  } catch (e) {
    console.error("NG word monitor error:", e?.message ?? e);
  }
});

client.on("guildMemberAdd", async (member) => {
  await sendLog(member.guild, `📥 ${member.user.tag} が参加しました`);
});

if (token) {
  client.login(token).catch((e) => console.error("❌ login failed:", e?.message ?? e));
} else {
  console.error("❌ DISCORD_TOKEN が無いのでログインできません");
}
