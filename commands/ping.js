import { SlashCommandBuilder } from "discord.js";

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

  await interaction.reply({
    content:
      `🏓 Pong!\n` +
      `現在のプラン: **${status}**`,
    ephemeral: true,
  });
}
