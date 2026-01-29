import { SlashCommandBuilder, PermissionsBitField, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを送信するチャンネルを設定します")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("ログ送信先チャンネル").setRequired(true)
  );

export async function execute(interaction, db) {
  // ★ まずACK（Aパッチが入ってれば二重でも安全）
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.editReply({ content: "❌ このコマンドは管理権限（サーバー管理）が必要です" });
  }

  const ch = interaction.options.getChannel("channel");

  if (!ch || !ch.isTextBased()) {
    return interaction.editReply({ content: "❌ テキストチャンネルを指定してください" });
  }

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
    interaction.guildId,
    ch.id
  );

  return interaction.editReply({ content: `✅ 管理ログの送信先を ${ch} に設定しました` });
}
