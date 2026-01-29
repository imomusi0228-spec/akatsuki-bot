// commands/admin.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("管理画面を開くリンクを表示（管理者向け）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  try {
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isAdmin) {
      return await interaction.editReply({ content: "❌ 管理者権限が必要です。" });
    }

    // ★常にトップページへ（そこからOAuthログイン→/adminへ）
    const base = interaction.client?.configBaseUrl || null;

    // フォールバック（手動設定が必要な場合）
    const url =
      process.env.PUBLIC_URL ||
      "https://YOUR-RENDER-URL.onrender.com";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("管理画面を開く")
        .setStyle(ButtonStyle.Link)
        .setURL(url)
    );

    return await interaction.editReply({
      content: `🔐 管理者用ページはこちら\n${url}`,
      components: [row],
    });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("admin command error:", e);
    try {
      await interaction.editReply({ content: `❌ エラー: ${e?.message ?? e}` });
    } catch {}
  }
}
