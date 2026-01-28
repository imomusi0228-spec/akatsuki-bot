import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを流すチャンネルを設定します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("管理ログを流すチャンネル")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction, db) {
  // ★これが超重要：まず受付を返す（3秒制限回避）
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (!interaction.guildId) {
      return interaction.editReply("❌ サーバー内で実行してください。");
    }
    if (!db) {
      return interaction.editReply("❌ DBが初期化できていません。Renderログを確認してください。");
    }

    const channel = interaction.options.getChannel("channel", true);

    // テキストチャンネル/スレッド以外を弾きたい場合はここで制限できる
    // if (!channel.isTextBased()) return interaction.editReply("❌ テキストチャンネルを指定してください。");

    await db.run(
      `INSERT INTO settings (guild_id, log_channel_id)
       VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
      interaction.guildId,
      channel.id
    );

    return interaction.editReply(`✅ 管理ログ送信先を ${channel} に設定しました。`);
  } catch (e) {
    console.error("setlog error:", e);
    return interaction.editReply(`❌ エラー: ${e?.message ?? e}`);
  }
}
