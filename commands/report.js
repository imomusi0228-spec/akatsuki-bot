import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { sendLog } from "../core/logger.js";

export const data = new SlashCommandBuilder()
    .setName("report")
    .setDescription("問題のあるメンバーをモデレーターに報告します。")
    .addUserOption(opt => opt.setName("user").setDescription("報告するメンバー").setRequired(true))
    .addStringOption(opt => opt.setName("reason").setDescription("報告理由").setRequired(true))
    .addStringOption(opt => opt.setName("message_id").setDescription("問題のメッセージID（任意）").setRequired(false));

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const messageId = interaction.options.getString("message_id");

    if (targetUser.id === interaction.user.id) {
        return interaction.editReply({ content: "❌ 自分自身を報告することはできません。" });
    }
    if (targetUser.bot) {
        return interaction.editReply({ content: "❌ Botを報告することはできません。" });
    }

    const embed = new EmbedBuilder()
        .setTitle("🚨 メンバー報告")
        .setColor(0xFF4444)
        .addFields(
            { name: "報告対象", value: `<@${targetUser.id}> (${targetUser.tag})`, inline: true },
            { name: "報告者", value: `<@${interaction.user.id}>`, inline: true },
            { name: "チャンネル", value: `<#${interaction.channel.id}>`, inline: true },
            { name: "理由", value: reason },
            ...(messageId ? [{ name: "メッセージID", value: messageId }] : [])
        )
        .setThumbnail(targetUser.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: "この報告はモデレーターのみに表示されます。" });

    const sent = await sendLog(interaction.guild, 'ng', embed);

    if (sent) {
        await interaction.editReply("✅ 報告をモデレーターに送信しました。ご協力ありがとうございます。");
    } else {
        await interaction.editReply("⚠️ 報告を受け付けましたが、ログチャンネルが設定されていないため通知できませんでした。");
    }
}
