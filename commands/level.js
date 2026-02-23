import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("level")
    .setDescription("現在のレベルとXPを表示します。")
    .addUserOption(opt => opt.setName("user").setDescription("レベルを確認するユーザー").setRequired(false));

export async function execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const guildId = interaction.guild.id;

    const res = await dbQuery("SELECT xp, level, total_vc_minutes, message_count FROM member_stats WHERE guild_id = $1 AND user_id = $2", [guildId, target.id]);

    if (res.rows.length === 0) {
        return interaction.reply({ content: `ℹ️ ${target.username} さんのデータはまだありません。`, ephemeral: true });
    }

    const { xp, level, total_vc_minutes, message_count } = res.rows[0];
    const nextLevelXp = level * level * 100;
    const progress = Math.min(100, Math.floor((xp / nextLevelXp) * 100));

    // Simple progress bar
    const barSize = 10;
    const filled = Math.floor(progress / (100 / barSize));
    const bar = "🟦".repeat(filled) + "⬜".repeat(barSize - filled);

    const embed = new EmbedBuilder()
        .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
        .setTitle(`🌟 レベルステータス`)
        .setColor(0x00A2E8)
        .addFields(
            { name: "レベル", value: `**Lv. ${level}**`, inline: true },
            { name: "経験値 (XP)", value: `${xp} / ${nextLevelXp}`, inline: true },
            { name: "進捗", value: `${bar} (${progress}%)` },
            { name: "統計", value: `💬 メッセージ: ${message_count || 0}通\n🎙️ VC滞在: ${total_vc_minutes || 0}分` }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
