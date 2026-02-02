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
  .setDescription("https://akatsuki-bot-f7ez.onrender.com")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // ✅ まず3秒以内にACK
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    throw e;
  }

  const sendPublic =
    interaction.publicSend
      ? interaction.publicSend.bind(interaction)
      : async (payload) => interaction.channel?.send(payload).catch(() => null);

  const finish = async (msg = "OK") => {
    try {
      await interaction.editReply(msg);
      setTimeout(() => interaction.deleteReply().catch(() => { }), 1500);
    } catch { }
  };

};

try {
  // ティアチェック（新規追加）
  const { isTierAtLeast } = await import("../utils/common.js");
  if (!isTierAtLeast(interaction.userTier, "pro")) {
    await finish("🚫 この機能はProプラン以上で使用可能です。");
    return;
  }

  const isAdmin =
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

  if (!isAdmin) {
    await finish("❌ 管理者権限が必要です。");
    return;
  }

  // ✅ 指定されたURLを使用
  const base = "https://akatsuki-bot-f7ez.onrender.com";

  // ✅ 直で /admin に飛ばす
  const url = base.endsWith("/") ? `${base}admin` : `${base}/admin`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("管理画面を開く")
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );

  // チャンネルにリンクを送信（公開）
  await sendPublic({
    content: `🔐 管理者用ページはこちら\n${url}`,
    components: [row],
  });

  await finish("✅ 送信しました");
} catch (e) {
  console.error("admin command error:", e);
  await finish(`❌ エラー: ${e?.message ?? String(e)}`);
}
}
