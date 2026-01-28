import {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import 'dotenv/config';

// ===============================
// 基本設定
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const db = new sqlite3.Database('./data.db');
db.exec(fs.readFileSync('./schema.sql', 'utf8'));

const joinTimes = new Map();

// ===============================
// Bot起動
// ===============================
client.once('ready', async () => {
  console.log(`Akatsuki Bot logged in as ${client.user.tag}`);

  // Slash Command 登録
  await client.application.commands.set([
    new SlashCommandBuilder()
      .setName('vc_stats')
      .setDescription('指定ユーザーのVC滞在時間を確認')
      .addUserOption(o =>
        o.setName('user').setDescription('対象ユーザー').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('badword_add')
      .setDescription('不適切ワードを追加')
      .addStringOption(o =>
        o.setName('word').setDescription('ワード').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
      .setName('badword_remove')
      .setDescription('不適切ワードを削除')
      .addStringOption(o =>
        o.setName('word').setDescription('ワード').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ]);
});

// ===============================
// VC滞在時間計測（マルチギルド）
// ===============================
client.on('voiceStateUpdate', (oldState, newState) => {
  const guildId = newState.guild.id;
  const userId = newState.id;

  if (!oldState.channel && newState.channel) {
    joinTimes.set(`${guildId}:${userId}`, Date.now());
  }

  if (oldState.channel && !newState.channel) {
    const key = `${guildId}:${userId}`;
    const joined = joinTimes.get(key);
    if (!joined) return;

    const diff = Date.now() - joined;
    joinTimes.delete(key);

    db.run(
      `INSERT INTO vc_time (guild_id, user_id, total_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(guild_id, user_id)
       DO UPDATE SET total_ms = total_ms + ?`,
      [guildId, userId, diff, diff]
    );
  }
});

// ===============================
// 不適切ワード監視
// ===============================
client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;

  const guildId = message.guild.id;
  const userId = message.author.id;

  db.all(
    'SELECT word FROM bad_words WHERE guild_id = ?',
    [guildId],
    async (_, rows) => {
      for (const r of rows) {
        if (message.content.includes(r.word)) {
          await message.delete();

          // 本人だけに警告（ephemeral代替：reply→delete）
          const warn = await message.reply({
            content: '⚠️ 不適切な表現が検出されました。',
            allowedMentions: { repliedUser: true }
          });
          setTimeout(() => warn.delete(), 5000);

          addWarning(message.member);
          break;
        }
      }
    }
  );
});

// ===============================
// 警告処理 & 自動タイムアウト
// ===============================
function addWarning(member) {
  const guildId = member.guild.id;
  const userId = member.id;

  db.get(
    'SELECT count FROM warnings WHERE guild_id = ? AND user_id = ?',
    [guildId, userId],
    async (_, row) => {
      const next = (row?.count || 0) + 1;

      db.run(
        `INSERT INTO warnings (guild_id, user_id, count)
         VALUES (?, ?, ?)
         ON CONFLICT(guild_id, user_id)
         DO UPDATE SET count = ?`,
        [guildId, userId, next, next]
      );

      const log = member.guild.channels.cache.get(
        process.env.ADMIN_LOG_CHANNEL_ID
      );
      log?.send(`⚠️ <@${userId}> 警告 ${next} 回`);

      if (next >= 3) {
        await member.timeout(5 * 60 * 1000, '警告3回');
        log?.send(`⏱ <@${userId}> を5分タイムアウト`);
        db.run(
          'DELETE FROM warnings WHERE guild_id = ? AND user_id = ?',
          [guildId, userId]
        );
      }
    }
  );
}

// ===============================
// Slash Command 処理
// ===============================
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (
    !interaction.memberPermissions.has(PermissionFlagsBits.Administrator)
  ) {
    return interaction.reply({
      content: '管理者専用コマンドです。',
      ephemeral: true
    });
  }

  const guildId = interaction.guildId;

  // VC統計
  if (interaction.commandName === 'vc_stats') {
    const user = interaction.options.getUser('user');

    db.get(
      'SELECT total_ms FROM vc_time WHERE guild_id = ? AND user_id = ?',
      [guildId, user.id],
      (_, row) => {
        const h = row ? (row.total_ms / 3600000).toFixed(2) : 0;
        interaction.reply({
          content: `⏱ ${user.username} のVC滞在時間：${h} 時間`,
          ephemeral: true
        });
      }
    );
  }

  // NGワード追加
  if (interaction.commandName === 'badword_add') {
    const word = interaction.options.getString('word');
    db.run(
      'INSERT INTO bad_words (guild_id, word) VALUES (?, ?)',
      [guildId, word]
    );
    interaction.reply({ content: `✅ 追加しました: ${word}`, ephemeral: true });
  }

  // NGワード削除
  if (interaction.commandName === 'badword_remove') {
    const word = interaction.options.getString('word');
    db.run(
      'DELETE FROM bad_words WHERE guild_id = ? AND word = ?',
      [guildId, word]
    );
    interaction.reply({ content: `🗑 削除しました: ${word}`, ephemeral: true });
  }
});

client.login(process.env.TOKEN);
