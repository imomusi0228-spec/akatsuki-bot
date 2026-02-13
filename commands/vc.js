import { SlashCommandBuilder, ContextMenuCommandBuilder, ApplicationCommandType, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = [
    new SlashCommandBuilder()
        .setName("vc")
        .setDescription("VC滞在時間の統計を表示・管理します。")
        .addSubcommand(sub =>
            sub.setName("top")
                .setDescription("今月の滞在時間ランキングを表示します。")
        )
        .addSubcommand(sub =>
            sub.setName("user")
                .setDescription("特定ユーザーの滞在時間を表示します。")
                .addUserOption(opt => opt.setName("target").setDescription("対象ユーザー").setRequired(true))
        ),
    new ContextMenuCommandBuilder()
        .setName("VC滞在統計を表示")
        .setType(ApplicationCommandType.User)
];

export async function execute(interaction) {
    const guildId = interaction.guild.id;

    // Handle Context Menu
    if (interaction.isUserContextMenuCommand()) {
        const target = interaction.targetUser;
        const stats = await getUserVCStats(guildId, target.id);

        const embed = new EmbedBuilder()
            .setTitle(`📊 VC Activity: ${target.username}`)
            .setThumbnail(target.displayAvatarURL())
            .setColor(0x1DA1F2)
            .addFields(
                { name: "今月の滞在時間", value: `**${stats.currentMonth}** 時間`, inline: true },
                { name: "先月の滞在時間", value: `**${stats.lastMonth}** 時間`, inline: true },
                { name: "累計滞在時間", value: `**${stats.total}** 時間`, inline: false }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "top") {
        const res = await dbQuery(`
            SELECT user_id, SUM(duration_seconds) as total
            FROM vc_sessions
            WHERE guild_id = $1 
            AND join_time >= date_trunc('month', CURRENT_DATE)
            GROUP BY user_id
            ORDER BY total DESC
            LIMIT 10
        `, [guildId]);

        if (res.rows.length === 0) {
            await interaction.reply("今月のデータはありません。");
            return;
        }

        let msg = "📊 **今月のVC滞在時間ランキング**\n";
        for (let i = 0; i < res.rows.length; i++) {
            const row = res.rows[i];
            const hours = (row.total / 3600).toFixed(1);
            msg += `${i + 1}. <@${row.user_id}>: ${hours}時間\n`;
        }
        await interaction.reply({ content: msg, allowedMentions: { parse: [] } });
    }

    if (sub === "user") {
        const target = interaction.options.getUser("target");
        const stats = await getUserVCStats(guildId, target.id);
        await interaction.reply({ content: `👤 **${target.tag}** の今月のVC時間: **${stats.currentMonth}時間** (累計: ${stats.total}時間)` });
    }
}

async function getUserVCStats(guildId, userId) {
    const res = await dbQuery(`
        SELECT 
            SUM(CASE WHEN join_time >= date_trunc('month', CURRENT_DATE) THEN duration_seconds ELSE 0 END) as current_month,
            SUM(CASE WHEN join_time >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND join_time < date_trunc('month', CURRENT_DATE) THEN duration_seconds ELSE 0 END) as last_month,
            SUM(duration_seconds) as total
        FROM vc_sessions
        WHERE guild_id = $1 AND user_id = $2
    `, [guildId, userId]);

    const row = res.rows[0] || {};
    return {
        currentMonth: ((row.current_month || 0) / 3600).toFixed(1),
        lastMonth: ((row.last_month || 0) / 3600).toFixed(1),
        total: ((row.total || 0) / 3600).toFixed(1)
    };
}
