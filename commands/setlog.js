import { SlashCommandBuilder, PermissionsBitField, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを送信するチャンネルを設定します")
  .addChannelOption((opt) =>
    opt.setName("channel").setDescription("ログ送信先チャンネル").setRequired(true)
  );

export async function execute(interaction, db) {
  // ✅ まず3秒以内にACK（これがないと例の通知が出る）
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

  // ✅ 権限チェック
  if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
    // 通常投稿（ログっぽく）
    await interaction.channel?.send({
      content: "❌ このコマンドは管理権限（サーバー管理）が必要です",
    }).catch(() => null);

    // ACKは残さない
    setTimeout(() => interaction.deleteReply().catch(() => null), 1500);
    return;
  }

  const ch = interaction.options.getChannel("channel");
  if (!ch || !ch.isTextBased()) {
    await interaction.channel?.send({ content: "❌ テキストチャンネルを指定してください" }).catch(() => null);
    setTimeout(() => interaction.deleteReply().catch(() => null), 1500);
    return;
  }

  // DB更新
  await db.run(
    `INSERT INTO settings (guild_id, log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
    interaction.guildId,
    ch.id
  );

  // ✅ “ログっぽく” 通常投稿
  const embed = new EmbedBuilder()
    .setDescription(`✅ 管理ログの送信先を ${ch} に設定しました`)
    .setTimestamp(new Date());

  await interaction.channel?.send({ embeds: [embed] }).catch(() => null);

  // ✅ ACKは消す（ephemeralなので本人にしか見えない＆消してもOK）
  setTimeout(() => interaction.deleteReply().catch(() => null), 1500);
}
