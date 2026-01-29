import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("setlog")
  .setDescription("管理ログを流すチャンネルを設定します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("管理ログを流すチャンネル")
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

function isUnknownInteraction(err) {
  return err?.code === 10062 || err?.rawError?.code === 10062;
}
function isAlreadyAck(err) {
  return err?.code === 40060 || err?.rawError?.code === 40060;
}

async function safeDefer(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try {
    // ephemeral
    await interaction.deferReply({ ephemeral: true });
  } catch (e) {
    // 期限切れ/すでにACK済みは黙って終了（落とさない）
    if (isUnknownInteraction(e) || isAlreadyAck(e)) return;
    throw e;
  }
}

async function safeSend(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content });
    }
    return await interaction.reply({ content, ephemeral: true });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    if (isAlreadyAck(e)) {
      // 競合したらfollowUpで返す
      try {
        return await interaction.followUp({ content, ephemeral: true });
      } catch (e2) {
        if (isUnknownInteraction(e2)) return;
      }
    }
    throw e;
  }
}

export async function execute(interaction, db) {
  await safeDefer(interaction);

  try {
    if (!interaction.guildId) {
      await safeSend(interaction, "❌ サーバー内で実行してください。");
      return;
    }
    if (!db) {
      await safeSend(interaction, "❌ DBが初期化できていません（Renderログ確認）");
      return;
    }

    const channel = interaction.options.getChannel("channel", true);

    await db.run(
      `INSERT INTO settings (guild_id, log_channel_id)
       VALUES (?, ?)
       ON CONFLICT(guild_id) DO UPDATE SET log_channel_id = excluded.log_channel_id`,
      interaction.guildId,
      channel.id
    );

    await safeSend(interaction, `✅ 管理ログ送信先を ${channel} に設定しました。`);
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    console.error("setlog error:", e);
    try {
      await safeSend(interaction, `❌ エラー: ${e?.message ?? String(e)}`);
    } catch {}
  }
}
