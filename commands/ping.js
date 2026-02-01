import { SlashCommandBuilder } from "discord.js";

// index.js 側で定義した関数を global で使う想定
// guildHasProAdmin は interaction.guild を渡せばOK

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Botの応答とサーバーのプラン状態を確認します");

export async function execute(interaction) {
  const guild = interaction.guild;

  let proEnabled = false;
  try {
    proEnabled = guild ? await global.guildHasProAdmin(guild) : false;
  } catch {
    proEnabled = false;
  }

  const status = proEnabled ? "🟢 PRO（有料機能ON）" : "⚪ FREE（検出のみ）";

  await interaction.reply({
    content:
      `🏓 Pong!\n` +
      `サーバープラン: **${status}**\n` +
      `（PRO/PRO+ロール持ち管理者が1人でも居ると有効）`,
    ephemeral: true,
  });
}
