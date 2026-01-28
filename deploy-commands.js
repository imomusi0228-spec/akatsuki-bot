require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [

  new SlashCommandBuilder()
    .setName('badword')
    .setDescription('不適切ワード管理')
    .addSubcommand(sc =>
      sc.setName('add')
        .setDescription('ワード追加')
        .addStringOption(o => o.setName('word').setDescription('ワード').setRequired(true)))
    .addSubcommand(sc =>
      sc.setName('remove')
        .setDescription('ワード削除')
        .addStringOption(o => o.setName('word').setDescription('ワード').setRequired(true)))
    .addSubcommand(sc =>
      sc.setName('list')
        .setDescription('一覧表示')),

  new SlashCommandBuilder()
    .setName('log')
    .setDescription('管理ログ設定')
    .addSubcommand(sc =>
      sc.setName('set')
        .setDescription('ログチャンネル設定')
        .addChannelOption(o => o.setName('channel').setRequired(true)))
    .addSubcommand(sc =>
      sc.setName('show')
        .setDescription('現在の設定表示')),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('警告管理')
    .addSubcommand(sc =>
      sc.setName('count')
        .setDescription('警告数確認')
        .addUserOption(o => o.setName('user').setRequired(true)))
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  await rest.put(
    Routes.applicationCommands(process.env.CLIENT_ID),
    { body: commands.map(c => c.toJSON()) }
  );
  console.log('✅ スラッシュコマンド登録完了');
})();
