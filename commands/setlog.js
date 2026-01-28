import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

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

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

export async function execute(interaction, db) {
  // すでに別プロセスが応答済みでも落とさない
  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (e) {
    if (isUnknownInteraction(e)) return; // 二重起動時の負け側
    throw e;
  }

  try {
    if (!interaction.guildId) {
      return await interaction.editReply("❌ サーバー内で実行してください。");
    }
    if (!db) {
      return await interaction.editReply("❌ DBが初期化できていません（Renderログ確認）");
    }

    const channel = interaction.options.getChannel("channel", true);

    await db.run(
      `INSERT INTO settings (guild_id, log_channel_id)
       VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
      interaction.guildId,
      channel.id
    );

    await interaction.editReply(`✅ 管理ログ送信先を ${channel} に設定しました。`);
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("setlog error:", e);
    try {
      await interaction.editReply(`❌ エラー: ${e?.message ?? e}`);
    } catch {}
  }
}
