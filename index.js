// index.js (Render対応・完成版)
// 前提: package.json に "type": "module"
// npm i discord.js sqlite3 dotenv

import "dotenv/config";
import http from "node:http";
import sqlite3 from "sqlite3";
import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
} from "discord.js";

/* -----------------------------
 * Render Web Service 対応：ポート待受
 * ----------------------------- */
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Akatsuki bot is running");
  })
  .listen(PORT, () => console.log(`🌐 Health server listening on :${PORT}`));

/* -----------------------------
 * 必須ENV
 * ----------------------------- */
const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN が未設定です (.env / Render Env Vars)");
  process.exit(1);
}
if (!CLIENT_ID) {
  console.error("❌ CLIENT_ID が未設定です (.env / Render Env Vars)");
  process.exit(1);
}

/* -----------------------------
 * SQLite（永続）
 * ----------------------------- */
const db = new sqlite3.Database("./akatsuki.db");

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

await run(`
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY,
  log_channel_id TEXT
);
`);
await run(`
CREATE TABLE IF NOT EXISTS bad_words (
  guild_id TEXT,
  word TEXT
);
`);
await run(`
CREATE TABLE IF NOT EXISTS warnings (
  guild_id TEXT,
  user_id TEXT,
  count INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
`);
await run(`
CREATE TABLE IF NOT EXISTS vc_time (
  guild_id TEXT,
  user_id TEXT,
  total_ms INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
`);

/* -----------------------------
 * Discord Client
 * ----------------------------- */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 特権
    GatewayIntentBits.GuildMembers,   // 特権（timeout安定のため）
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const vcJoin = new Map(); // key = guildId:userId -> joinedAt

/* -----------------------------
 * Slash Commands 定義
 * ----------------------------- */
const commands = [
  new SlashCommandBuilder()
    .setName("badword")
    .setDescription("不適切ワード管理（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName("add")
        .setDescription("ワード追加")
        .addStringOption((o) =>
          o.setName("word").setDescription("追加するワード").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("remove")
        .setDescription("ワード削除")
        .addStringOption((o) =>
          o.setName("word").setDescription("削除するワード").setRequired(true)
        )
    )
    .addSubcommand((sc) => sc.setName("list").setDescription("一覧表示")),

  new SlashCommandBuilder()
    .setName("log")
    .setDescription("管理ログ送信先の設定（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName("set")
        .setDescription("ログチャンネルを設定")
        .addChannelOption((o) =>
          o
            .setName("channel")
            .setDescription("ログ送信先チャンネル")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sc) => sc.setName("show").setDescription("現在の設定を表示"))
    .addSubcommand((sc) => sc.setName("clear").setDescription("設定を解除")),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("警告管理（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName("count")
        .setDescription("ユーザーの警告回数を確認")
        .addUserOption((o) =>
          o.setName("user").setDescription("対象ユーザー").setRequired(true)
        )
    )
    .addSubcommand((sc) =>
      sc
        .setName("reset")
        .setDescription("ユーザーの警告回数をリセット")
        .addUserOption((o) =>
          o.setName("user").setDescription("対象ユーザー").setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("vc")
    .setDescription("VC統計（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sc) =>
      sc
        .setName("time")
        .setDescription("ユーザーの累計VC時間を確認")
        .addUserOption((o) =>
          o.setName("user").setDescription("対象ユーザー").setRequired(true)
        )
    ),
].map((c) => c.toJSON());

/* -----------------------------
 * 補助：ログチャンネル取得
 * ----------------------------- */
async function getLogChannel(guild) {
  const row = await get(
    "SELECT log_channel_id FROM guild_settings WHERE guild_id = ?",
    [guild.id]
  );
  if (!row?.log_channel_id) return null;
  return guild.channels.cache.get(row.log_channel_id) ?? null;
}

/* -----------------------------
 * Ready
 * ----------------------------- */
client.once("ready", async () => {
  console.log(`✅ Akatsuki Bot logged in as ${client.user.tag}`);

  // グローバル登録（反映に時間がかかることがあります）
  // 反映を速くしたいなら deploy-commands.js 方式に分けるのが確実
  await client.application.commands.set(commands);
  console.log("✅ Slash commands registered (global)");
});

/* -----------------------------
 * VC計測
 * ----------------------------- */
client.on("voiceStateUpdate", async (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.id;
  const key = `${guildId}:${userId}`;

  if (!oldState.channel && newState.channel) {
    vcJoin.set(key, Date.now());
  }

  if (oldState.channel && !newState.channel) {
    const joinedAt = vcJoin.get(key);
    if (!joinedAt) return;
    vcJoin.delete(key);

    const dur = Date.now() - joinedAt;
    await run(
      `INSERT INTO vc_time (guild_id, user_id, total_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id)
       DO UPDATE SET total_ms = total_ms + ?`,
      [guildId, userId, dur, dur]
    );
  }
});

/* -----------------------------
 * 不適切ワード監視 → 削除 → DM警告 → 管理ログ → 3回でタイムアウト
 * ----------------------------- */
client.on("messageCreate", async (message) => {
  try {
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;

    const rows = await all("SELECT word FROM bad_words WHERE guild_id = ?", [
      guildId,
    ]);
    if (!rows.length) return;

    const hit = rows.find((r) => message.content.includes(r.word));
    if (!hit) return;

    const originalContent = message.content;
    const author = message.author;
    const member = message.member; // メッセージから取れる（権限/intentで安定）

    // 1) メッセージ削除（※ reply しない：replyは参照エラーの原因）
    await message.delete().catch(() => {});

    // 2) 警告カウント更新
    const row = await get(
      "SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?",
      [guildId, author.id]
    );
    const next = (row?.count ?? 0) + 1;

    await run(
      `INSERT INTO warnings (guild_id, user_id, count)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id)
       DO UPDATE SET count = ?`,
      [guildId, author.id, next, next]
    );

    // 3) DMで本人に警告（DM不可はcatch）
    let dmStatus = "✅ 送信成功";
    try {
      await author.send(
        [
          "⚠️ 不適切な表現が検出されました。",
          `・サーバー: ${message.guild.name}`,
          `・チャンネル: #${message.channel.name}`,
          `・検出ワード: ${hit.word}`,
          `・内容: ${originalContent}`,
          `・警告回数: ${next}回（3回で5分タイムアウト）`,
        ].join("\n")
      );
    } catch {
      dmStatus = "❌ DM送信不可（ユーザー設定）";
    }

    // 4) 管理ログへ送信（設定されている場合のみ）
    const logCh = await getLogChannel(message.guild);
    if (logCh) {
      await logCh.send({
        embeds: [
          {
            title: "🚨 不適切ワード検出",
            fields: [
              { name: "ユーザー", value: `${author.tag} (${author.id})` },
              { name: "チャンネル", value: `${message.channel} (${message.channel.id})` },
              { name: "検出ワード", value: hit.word },
              { name: "内容", value: originalContent.slice(0, 900) || "(空)" },
              { name: "警告回数", value: `${next}回` },
              { name: "DM", value: dmStatus },
            ],
            timestamp: new Date().toISOString(),
          },
        ],
      }).catch(() => {});
    }

    // 5) 3回で5分タイムアウト → 警告リセット
    if (next >= 3 && member) {
      await member.timeout(5 * 60 * 1000, "Akatsuki: 警告3回").catch(() => {});
      await run("UPDATE warnings SET count = 0 WHERE guild_id = ? AND user_id = ?", [
        guildId,
        author.id,
      ]);
      if (logCh) {
        await logCh.send(`⏱ <@${author.id}> を **5分タイムアウト**（警告3回）`).catch(() => {});
      }
    }
  } catch (e) {
    console.error("messageCreate error:", e);
  }
});

/* -----------------------------
 * Slash Commands 実行
 * ----------------------------- */
client.on("interactionCreate", async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;

    // 二重防御（管理者のみ）
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: "❌ 管理者専用コマンドです。", flags: 64 });
    }

    const guildId = interaction.guildId;

    // /badword ...
    if (interaction.commandName === "badword") {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const word = interaction.options.getString("word", true);
        await run("INSERT INTO bad_words (guild_id, word) VALUES (?, ?)", [
          guildId,
          word,
        ]);
        return interaction.reply({ content: `✅ 追加しました: ${word}`, flags: 64 });
      }
      if (sub === "remove") {
        const word = interaction.options.getString("word", true);
        await run("DELETE FROM bad_words WHERE guild_id = ? AND word = ?", [
          guildId,
          word,
        ]);
        return interaction.reply({ content: `🗑 削除しました: ${word}`, flags: 64 });
      }
      if (sub === "list") {
        const rows = await all("SELECT word FROM bad_words WHERE guild_id = ?", [
          guildId,
        ]);
        const list = rows.map((r) => r.word);
        return interaction.reply({
          content: list.length ? `📄 登録ワード:\n- ${list.join("\n- ")}` : "（未登録）",
          flags: 64,
        });
      }
    }

    // /log ...
    if (interaction.commandName === "log") {
      const sub = interaction.options.getSubcommand();
      if (sub === "set") {
        const ch = interaction.options.getChannel("channel", true);
        await run(
          `INSERT INTO guild_settings (guild_id, log_channel_id)
           VALUES (?, ?)
           ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
          [guildId, ch.id]
        );
        return interaction.reply({
          content: `✅ 管理ログ送信先を ${ch} に設定しました`,
          flags: 64,
        });
      }
      if (sub === "show") {
        const row = await get(
          "SELECT log_channel_id FROM guild_settings WHERE guild_id = ?",
          [guildId]
        );
        return interaction.reply({
          content: row?.log_channel_id
            ? `📌 現在のログ送信先: <#${row.log_channel_id}>`
            : "⚠ ログ送信先は未設定です（/log set で設定）",
          flags: 64,
        });
      }
      if (sub === "clear") {
        await run(
          `INSERT INTO guild_settings (guild_id, log_channel_id)
           VALUES (?, NULL)
           ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = NULL`,
          [guildId]
        );
        return interaction.reply({ content: "🗑 ログ送信先を解除しました", flags: 64 });
      }
    }

    // /warn ...
    if (interaction.commandName === "warn") {
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser("user", true);
      if (sub === "count") {
        const row = await get(
          "SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?",
          [guildId, user.id]
        );
        return interaction.reply({
          content: `⚠ ${user.tag} の警告回数: **${row?.count ?? 0}回**`,
          flags: 64,
        });
      }
      if (sub === "reset") {
        await run(
          `INSERT INTO warnings (guild_id, user_id, count)
           VALUES (?, ?, 0)
           ON CONFLICT(guild_id, user_id) DO UPDATE SET count = 0`,
          [guildId, user.id]
        );
        return interaction.reply({ content: `✅ ${user.tag} の警告をリセットしました`, flags: 64 });
      }
    }

    // /vc time ...
    if (interaction.commandName === "vc") {
      const sub = interaction.options.getSubcommand();
      if (sub === "time") {
        const user = interaction.options.getUser("user", true);
        const row = await get(
          "SELECT total_ms FROM vc_time WHERE guild_id = ? AND user_id = ?",
          [guildId, user.id]
        );
        const hours = ((row?.total_ms ?? 0) / 3600000).toFixed(2);
        return interaction.reply({
          content: `🎧 ${user.tag} の累計VC滞在時間: **${hours}時間**`,
          flags: 64,
        });
      }
    }

    // 未処理
    return interaction.reply({ content: "⚠ コマンド未対応です。", flags: 64 });
  } catch (e) {
    console.error("interactionCreate error:", e);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "❌ 内部エラーが発生しました。", flags: 64 });
      }
    } catch {}
  }
});

process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));

await client.login(TOKEN);
