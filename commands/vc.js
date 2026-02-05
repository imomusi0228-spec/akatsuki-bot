import { SlashCommandBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("vc")
    .setDescription("VC滞在時間の統計")
    .addSubcommand(sub =>
        sub.setName("top")
            .setDescription("今月の滞在時間ランキングを表示")
    )
    .addSubcommand(sub =>
        sub.setName("user")
            .setDescription("特定ユーザーの滞在時間を表示")
            .addUserOption(opt => opt.setName("target").setDescription("対象ユーザー").setRequired(true))
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "top") {
        // Simple Logic: Sum duration for current month
        // PG specific: date_trunc or similar
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
        await interaction.reply({ content: msg, allowedMentions: { parse: [] } }); // Don't ping
    }

    if (sub === "user") {
        const target = interaction.options.getUser("target");
        const res = await dbQuery(`
            SELECT SUM(duration_seconds) as total
            FROM vc_sessions
            WHERE guild_id = $1 AND user_id = $2
            AND join_time >= date_trunc('month', CURRENT_DATE)
        `, [guildId, target.id]);

        const totalSec = res.rows[0]?.total || 0;
        const hours = (totalSec / 3600).toFixed(1);

        await interaction.reply({ content: `👤 **${target.tag}** の今月のVC時間: **${hours}時間**` });
    }
}
