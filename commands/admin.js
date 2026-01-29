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

function normalizePublicUrl(raw) {
  let url = (raw || "").trim();

  // 末尾の / を削る
  url = url.replace(/\/+$/, "");

  // もし /admin まで入ってたら落とす（事故防止）
  url = url.replace(/\/admin$/i, "");

  // https が無ければ付ける（httpだとDiscord側で弾かれるケースあり）
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;

  // 念のため http を https に寄せる（Renderは基本 https）
  url = url.replace(/^http:\/\//i, "https://");

  return url;
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
    const base = normalizePublicUrl(process.env.PUBLIC_URL);
    if (!base) {
      return await interaction.editReply({
        content:
          "❌ PUBLIC_URL が未設定です。\nRender の環境変数 PUBLIC_URL に `https://xxxx.onrender.com` を設定してください。",
      });
    }

    const isAdmin =
      interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

    if (!isAdmin) {
      return await interaction.editReply({ content: "❌ 管理者権限が必要です。" });
    }

    const adminUrl = `${base}/admin`;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel("管理画面を開く")
        .setStyle(ButtonStyle.Link)
        .setURL(adminUrl)
    );

    // ★URLを本文にも出す（ボタンが開かない端末対策）
    return await interaction.editReply({
      content: `🔐 管理者用リンクです（他の人には見えません）\n${adminUrl}`,
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
