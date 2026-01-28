require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

/* ===== 簡易DB（本番はRedis/DBに置換可） ===== */
const badWords = new Map();       // guildId => [words]
const logChannels = new Map();    // guildId => channelId
const warns = new Map();          // guildId-userId => count

/* ===== 起動 ===== */
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ===== メッセージ監視 ===== */
client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;

  const words = badWords.get(message.guild.id) || [];
  const hit = words.find(w => message.content.includes(w));
  if (!hit) return;

  await message.delete().catch(() => {});

  const key = `${message.guild.id}-${message.author.id}`;
  const count = (warns.get(key) || 0) + 1;
  warns.set(key, count);

  /* DM警告 */
  try {
    await message.author.send(
      `⚠️ 不適切な表現を検知しました\nワード: **${hit}**\n警告回数: **${count}回**`
    );
  } catch {}

  /* 管理ログ */
  const logId = logChannels.get(message.guild.id);
  if (logId) {
    const log = await message.guild.channels.fetch(logId).catch(() => null);
    if (log) {
      log.send(
        `🚨 **不適切発言検知**\n` +
        `👤 ${message.author.tag}\n` +
        `📄 ${hit}\n` +
        `⚠️ 警告 ${count}回`
      );
    }
  }

  /* 3回でタイムアウト */
  if (count >= 3) {
    const member = await message.guild.members.fetch(message.author.id);
    member.timeout(5 * 60 * 1000, '警告3回').catch(() => {});
  }
});

/* ===== スラッシュコマンド ===== */
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ 管理者専用', ephemeral: true });
  }

  const { commandName, options, guildId } = interaction;

  /* --- badword --- */
  if (commandName === 'badword') {
    const list = badWords.get(guildId) || [];
    const word = options.getString('word');

    if (options.getSubcommand() === 'add') {
      list.push(word);
      badWords.set(guildId, list);
      return interaction.reply(`✅ 追加: ${word}`);
    }

    if (options.getSubcommand() === 'remove') {
      badWords.set(guildId, list.filter(w => w !== word));
      return interaction.reply(`🗑️ 削除: ${word}`);
    }

    if (options.getSubcommand() === 'list') {
      return interaction.reply({
        content: list.join(', ') || '（未登録）',
        ephemeral: true
      });
    }
  }

  /* --- log --- */
  if (commandName === 'log') {
    if (options.getSubcommand() === 'set') {
      const ch = options.getChannel('channel');
      logChannels.set(guildId, ch.id);
      return interaction.reply(`📌 管理ログ先: ${ch}`);
    }

    if (options.getSubcommand() === 'show') {
      const id = logChannels.get(guildId);
      return interaction.reply({
        content: id ? `<#${id}>` : '未設定',
        ephemeral: true
      });
    }
  }

  /* --- warn --- */
  if (commandName === 'warn') {
    const user = options.getUser('user');
    const key = `${guildId}-${user.id}`;
    return interaction.reply({
      content: `⚠️ ${user.tag}：${warns.get(key) || 0}回`,
      ephemeral: true
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
