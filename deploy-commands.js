import "dotenv/config";
import { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType } from "discord.js";

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ DISCORD_TOKEN / CLIENT_ID / GUILD_ID を全て設定してください");
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName("badword")
    .setDescription("不適切ワード管理（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc =>
      sc.setName("add")
        .setDescription("ワード追加")
        .addStringOption(o => o.setName("word").setDescription("ワード").setRequired(true))
    )
    .addSubcommand(sc =>
      sc.setName("remove")
        .setDescription("ワード削除")
        .addStringOption(o => o.setName("word").setDescription("ワード").setRequired(true))
    )
    .addSubcommand(sc => sc.setName("list").setDescription("一覧表示")),

  new SlashCommandBuilder()
    .setName("log")
    .setDescription("管理ログ送信先の設定（管理者のみ）")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sc =>
      sc.setName("set")
        .setDescription("ログチャンネルを設定")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("ログ送信先")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true)
        )
    )
    .addSubcommand(sc => sc.setName("show").setDescription("現在の設定を表示"))
    .addSubcommand(sc => sc.setName("clear").setDescription("設定を解除")),
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  console.log("🚀 Deploying guild commands...");
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log("✅ commands registered (guild)");
})();
