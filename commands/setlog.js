import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを送信するチャンネルを設定します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("ログ送信先チャンネル")
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, db) {
  const channel = interaction.options.getChannel("channel");

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
    interaction.guildId,
    channel.id
  );

  await interaction.reply({
    content: `✅ 管理ログ送信先を ${channel} に設定しました`,
    flags: MessageFlags.Ephemeral,
  });
}
