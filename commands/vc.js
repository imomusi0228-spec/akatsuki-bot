import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = [
    new SlashCommandBuilder()
        .setName("vc-name")
        .setDescription("【オーナー限定】自分のVCの名前を変更します")
        .addStringOption(opt => opt.setName("名前").setDescription("新しいチャンネル名").setRequired(true)),
    new SlashCommandBuilder()
        .setName("vc-limit")
        .setDescription("【オーナー限定】自分のVCの人数制限を変更します")
        .addIntegerOption(opt => opt.setName("上限").setDescription("最大人数（0で無制限）").setRequired(true).setMinValue(0).setMaxValue(99)),
    new SlashCommandBuilder()
        .setName("vc-owner")
        .setDescription("【オーナー限定】自分のVCのオーナー権限を譲渡します")
        .addUserOption(opt => opt.setName("ユーザー").setDescription("新しいオーナー").setRequired(true))
];

export async function execute(interaction) {
    const { commandName, guildId, user, member, options } = interaction;
    const channelId = member.voice.channelId;

    if (!channelId) {
        return interaction.reply({ content: "❌ VCに入室した状態で実行してくださいわ。", ephemeral: true });
    }

    // Check if the channel is an Auto-VC and the user is the owner
    const res = await dbQuery("SELECT * FROM auto_vc_channels WHERE channel_id = $1", [channelId]);
    if (res.rows.length === 0) {
        return interaction.reply({ content: "❌ このVCは自動生成されたものではないため、操作できませんわ。", ephemeral: true });
    }

    const room = res.rows[0];
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels);

    if (room.owner_id !== user.id && !isStaff) {
        return interaction.reply({ content: "❌ お嬢様の許可なく、他人の部屋を弄ろうとするなんて……あなたはここの「主（オーナー）」ではありませんわ。", ephemeral: true });
    }

    const channel = member.voice.channel;

    try {
        if (commandName === "vc-name") {
            const newName = options.getString("名前");
            await channel.setName(`🔊 ${newName}`);
            return interaction.reply({ content: `✅ チャンネル名を **${newName}** に変更しましたわ。`, ephemeral: true });
        }

        if (commandName === "vc-limit") {
            const limit = options.getInteger("上限");
            await channel.setUserLimit(limit);
            return interaction.reply({ content: `✅ 人数制限を **${limit === 0 ? "無制限" : limit + "人"}** に変更しましたわ。`, ephemeral: true });
        }

        if (commandName === "vc-owner") {
            const targetUser = options.getUser("ユーザー");
            if (targetUser.bot) return interaction.reply({ content: "❌ ロボットに主の座を譲るなんて、正気ですか？", ephemeral: true });

            await dbQuery("UPDATE auto_vc_channels SET owner_id = $1 WHERE channel_id = $2", [targetUser.id, channelId]);
            await channel.setName(`🔊 ${targetUser.username}の部屋`).catch(() => { });
            return interaction.reply({ content: `👑 <@${targetUser.id}> さんにこの部屋の主（オーナー）権限を譲渡しましたわ。` });
        }
    } catch (e) {
        console.error(`[VC CMD ERROR] ${commandName}:`, e);
        return interaction.reply({ content: "❌ 申し訳ありません。技術的な問題で操作に失敗しましたわ。", ephemeral: true });
    }
}
