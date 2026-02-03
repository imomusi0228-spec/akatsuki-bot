import { SlashCommandBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Botの応答とサーバーのプラン状態を確認します");

export async function execute(interaction) {
  // interaction.userTier is injected in index.js (interactionCreate)
  // or use getLicenseTierStrict locally if not injected.
  // In index.js I added `interaction.userTier = tier`.
  const tier = interaction.userTier || "free";

  let status = "⚪ Free (基本機能のみ)";
  if (tier === "pro") status = "🟢 Pro (活動モニタリング機能)";
  if (tier === "pro_plus") status = "🟣 Pro+ (全機能・ログ同期)";

  const publicUrl = process.env.PUBLIC_URL || "";
  const guideUrl = publicUrl ? (publicUrl.endsWith("/") ? `${publicUrl}guide` : `${publicUrl}/guide`) : null;

  let linkText = "";
  if (guideUrl) {
    linkText = `\n\n📖 **機能一覧・ご利用ガイド**\n${guideUrl}`;
  }

  await interaction.reply({
    content:
      `現在、当サーバーは **${status}** として登録されております。\n` +
      `機能の詳細や、より高度な活用方法につきましては、以下のガイドページをご覧くださいませ。` +
      linkText,
  });
}
