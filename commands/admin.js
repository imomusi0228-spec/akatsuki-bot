import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } from "discord.js";

const ADMIN_URL = process.env.PUBLIC_URL || "https://akatsuki-bot-wix4.onrender.com";

export const data = new SlashCommandBuilder()
  .setName("admin")
  .setDescription("管理画面を開くリンクを表示します（管理者向け）");

export async function execute(interaction) {
  // 管理者だけに見せたいならここで制限
  const member = interaction.member;
  const perms = member?.permissions;
  const ok =
    perms?.has(PermissionsBitField.Flags.Administrator) ||
    perms?.has(PermissionsBitField.Flags.ManageGuild);

  if (!ok) {
    return interaction.reply({ content: "このコマンドは管理者のみ使用できます。", ephemeral: true });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel("🛠 管理画面を開く")
      .setURL(`${ADMIN_URL}/admin`)
  );

  return interaction.reply({
    content: "管理画面はこちら：",
    components: [row],
    ephemeral: true, // 参加者に見せない（管理者本人だけに表示）
  });
}
