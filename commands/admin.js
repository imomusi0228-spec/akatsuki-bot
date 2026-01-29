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
  // 3秒制限対策（Unknown interaction 回避）
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  try {
    const url = (process.env.PUBLIC_URL || "").trim();
    if (!url) {
      return await interaction.editReply({
        content:
          "❌ PUBLIC_URL が未設定です。\nRender のURLを環境変数 PUBLIC_URL に設定してください（例: https://xxxx.onrender.com）",
      });
    }

    // Discord側の追加ガード（コマンド権限 + 実行者がAdminか）
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isAdmin) {
      return await interaction.editReply({
        content: "❌ 管理者権限が必要です。",
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("管理画面を開く")
        .setStyle(ButtonStyle.Link)
        .setURL(`${url.replace(/\/+$/, "")}/admin`)
    );

    return await interaction.editReply({
      content: "🔐 管理者用リンクです（他の人には見えません）。",
      components: [row],
    });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("admin command error:", e);
    try {
      await interaction.editReply({
        content: `❌ エラー: ${e?.message ?? e}`,
      });
    } catch {}
  }
}
