import { SlashCommandBuilder, PermissionsBitField } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを送信するチャンネルを設定します")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("ログ送信先チャンネル").setRequired(true)
  );

export async function execute(interaction, db) {
  // ★ まずACK（これが無いと「応答しませんでした」になる）
  await interaction.deferReply({ flags: 64 }); // Ephemeral

  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    return interaction.editReply("❌ このコマンドは管理権限が必要です");
  }

  const ch = interaction.options.getChannel("channel");

  if (!ch || !ch.isTextBased()) {
    return interaction.editReply("❌ テキストチャンネルを指定してください");
  }

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
    interaction.guildId,
    ch.id
  );

  return interaction.editReply(`✅ 管理ログの送信先を ${ch} に設定しました`);
}
