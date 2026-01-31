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
  // ✅ まず3秒以内にACK（これがないと通知が出る）
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  // publicSend が無い環境でも動くように保険
  const sendPublic =
    interaction.publicSend
      ? interaction.publicSend.bind(interaction)
      : async (payload) => interaction.channel?.send(payload).catch(() => null);

  const finish = async (msg = "OK") => {
    try {
      await interaction.editReply(msg);
      setTimeout(() => interaction.deleteReply().catch(() => {}), 1500);
    } catch {}
  };

  try {
    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isAdmin) {
      await finish("❌ 管理者権限が必要です。");
      return;
    }

    // ★常にトップページへ（そこからOAuthログイン→/adminへ）
    const base =
      interaction.client?.configBaseUrl ||
      process.env.PUBLIC_URL ||
      "https://YOUR-RENDER-URL.onrender.com";

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("管理画面を開く")
        .setStyle(ButtonStyle.Link)
        .setURL(base)
    );

    await sendPublic({
      content: `🔐 管理者用ページはこちら\n${base}`,
      components: [row],
    });

    await finish("✅ 送信しました");
  } catch (e) {
    console.error("admin command error:", e);
    await finish(`❌ エラー: ${e?.message ?? String(e)}`);
  }
}
