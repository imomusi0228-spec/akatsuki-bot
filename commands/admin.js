// commands/admin.js
import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("管理画面を開くリンクを表示（管理者向け）")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // interactionCreate 側で interaction.publicSend を生やしている前提

  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (!isAdmin) {
    await interaction.publicSend({ content: "❌ 管理者権限が必要です。" });
    return;
  }

  // ★常にトップページへ（そこからOAuthログイン→/adminへ）
  // configBaseUrl があるなら優先
  const base = interaction.client?.configBaseUrl || null;

  // フォールバック（PUBLIC_URL を推奨）
  const url = base || process.env.PUBLIC_URL || "https://YOUR-RENDER-URL.onrender.com";

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("管理画面を開く")
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );

  await interaction.publicSend({
    content: `🔐 管理者用ページはこちら\n${url}`,
    components: [row],
  });
}
