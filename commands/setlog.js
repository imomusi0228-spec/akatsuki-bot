import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";

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

// ACK済み/未ACKどっちでも確実にユーザーへ返すためのヘルパ
async function safeReply(interaction, content) {
  try {
    if (interaction.deferred || interaction.replied) {
      return await interaction.editReply({ content });
    }
    return await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch (e) {
    if (isUnknownInteraction(e)) return;
    // 競合で reply が先に走った等 → followUp に逃がす
    if (isAlreadyAck(e)) {
      try {
        return await interaction.followUp({
          content,
          flags: MessageFlags.Ephemeral,
        });
      } catch (e2) {
        if (isUnknownInteraction(e2)) return;
      }
    }
    throw e;
  }
}

async function safeDef
