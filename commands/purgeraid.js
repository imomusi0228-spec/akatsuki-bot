import pkg from "discord.js";
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = pkg;
import { dbQuery } from "../core/db.js";

/**
 * /purge-raid <mins>
 * Deletes messages from users who joined the server within the last <mins> minutes.
 * Designed to quickly clean up after specialized raid bot joins.
 */
export const data = new SlashCommandBuilder()
    .setName("purge-raid")
    .setDescription("直近の参加者による発言を一括削除 (鉄壁の要塞: 浄化)")
    .addIntegerOption(opt =>
        opt.setName("mins")
            .setDescription("過去何分間に参加したユーザーを対象にするか (1-60)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(60)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
    const mins = interaction.options.getInteger("mins");
    const guildId = interaction.guild.id;

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
        // 1. Identify potential raid users (those who joined in the last N minutes)
        // We use the member_events table which records joins in guildMemberAdd.js
        const res = await dbQuery(
            "SELECT DISTINCT user_id FROM member_events WHERE guild_id = $1 AND event_type = 'join' AND created_at > NOW() - (INTERVAL '1 minute' * $2)",
            [guildId, mins]
        );

        const raidUserIds = res.rows.map(r => r.user_id);

        if (raidUserIds.length === 0) {
            return interaction.editReply(`🔍 直近 ${mins} 分間に参加したユーザーのログは見つかりませんでした。`);
        }

        // 2. Scan all text channels for recent messages from these users
        let deletedCount = 0;
        const channels = interaction.guild.channels.cache.filter(c => c.isTextBased());

        for (const [id, channel] of channels) {
            try {
                // Fetch last 100 messages in each channel
                const messages = await channel.messages.fetch({ limit: 100 });
                // Filter messages belonging to the identified users
                const toDelete = messages.filter(m => raidUserIds.includes(m.author.id));

                if (toDelete.size > 0) {
                    // Bulk delete (only works for messages younger than 2 weeks)
                    // The 'true' argument filters out messages older than 14 days automatically
                    const deleted = await channel.bulkDelete(toDelete, true);
                    deletedCount += deleted.size;
                }
            } catch (e) {
                // Silent catch for permissions or other channel issues
            }
        }

        await interaction.editReply(`🧹 **一括浄化完了**\n直近 ${mins} 分間に参加した ${raidUserIds.length} 名のユーザーによる **${deletedCount} 件** のメッセージを削除しました。`);

    } catch (e) {
        console.error("[PURGE-RAID ERROR]:", e);
        await interaction.editReply("❌ 浄化処理の実行中にエラーが発生しました。");
    }
}
