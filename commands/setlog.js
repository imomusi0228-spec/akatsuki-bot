import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを送信するチャンネルを設定します")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("ログ送信先チャンネル").setRequired(true)
  );

export async function execute(interaction, db) {
  // ✅ 権限チェック
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    // 2枚目風：通常メッセージで返す
    await interaction.publicSend({
      content: "❌ このコマンドは管理権限（サーバー管理）が必要です",
    });
    return;
  }

  const ch = interaction.options.getChannel("channel");
  if (!ch || !ch.isTextBased()) {
    await interaction.publicSend({ content: "❌ テキストチャンネルを指定してください" });
    return;
  }

  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
    interaction.guildId,
    ch.id
  );

  // ✅ 2枚目みたいに “ログっぽく” 出す（通常投稿）
  const embed = new EmbedBuilder()
    .setDescription(`✅ 管理ログの送信先を ${ch} に設定しました`)
    .setTimestamp(new Date());

  await interaction.publicSend({ embeds: [embed] });
}
