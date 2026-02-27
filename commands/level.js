import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";

export const data = new SlashCommandBuilder()
    .setName("level")
    .setDescription("レベル・XP関連のコマンド")
    .addSubcommand(sub => sub
        .setName("rank")
        .setDescription("自分または指定ユーザーの現在のレベルとXPを表示します。")
        .addUserOption(opt => opt.setName("user").setDescription("確認するユーザー").setRequired(false))
    )
    .addSubcommand(sub => sub
        .setName("leaderboard")
        .setDescription("このサーバーのXPランキングトップ10を表示します。")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // leaderboard_enabled チェック（A-1: ON/OFF設定）
    const setRes = await dbQuery("SELECT leaderboard_enabled FROM settings WHERE guild_id = $1", [guildId]);
    const leaderboardEnabled = setRes.rows[0]?.leaderboard_enabled !== false; // default true

    if (sub === "rank") {
        const target = interaction.options.getUser("user") || interaction.user;
        const res = await dbQuery("SELECT xp, level, total_vc_minutes, message_count FROM member_stats WHERE guild_id = $1 AND user_id = $2", [guildId, target.id]);

        if (res.rows.length === 0) {
            return interaction.reply({ content: `ℹ️ ${target.username} さんのデータはまだありません。`, ephemeral: true });
        }

        const { xp, level, total_vc_minutes, message_count } = res.rows[0];
        const nextLevelXp = level * level * 100;
        const progress = Math.min(100, Math.floor((xp / nextLevelXp) * 100));

        const barSize = 10;
        const filled = Math.floor(progress / (100 / barSize));
        const bar = "🟦".repeat(filled) + "⬜".repeat(barSize - filled);

        // ランキング順位を取得
        const rankRes = await dbQuery("SELECT COUNT(*) as cnt FROM member_stats WHERE guild_id = $1 AND xp > $2", [guildId, xp]);
        const rank = parseInt(rankRes.rows[0]?.cnt || 0) + 1;

        const embed = new EmbedBuilder()
            .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
            .setTitle(`🌟 レベルステータス`)
            .setColor(0x00A2E8)
            .addFields(
                { name: "ランキング", value: `**#${rank}**`, inline: true },
                { name: "レベル", value: `**Lv. ${level}**`, inline: true },
                { name: "経験値 (XP)", value: `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`, inline: true },
                { name: "進捗", value: `${bar} (${progress}%)` },
                { name: "統計", value: `💬 メッセージ: ${(message_count || 0).toLocaleString()}通\n🎙️ VC滞在: ${(total_vc_minutes || 0).toLocaleString()}分` }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

    } else if (sub === "leaderboard") {
        if (!leaderboardEnabled) {
            return interaction.reply({ content: "❌ このサーバーではランキング機能が無効になっています。", ephemeral: true });
        }

        await interaction.deferReply();

        const statsRes = await dbQuery("SELECT user_id, xp, level, message_count, total_vc_minutes FROM member_stats WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10", [guildId]);

        if (statsRes.rows.length === 0) {
            return interaction.editReply("📊 まだ誰のデータもありません。");
        }

        const rows = await Promise.all(statsRes.rows.map(async (row, i) => {
            let user = client.users.cache.get(row.user_id);
            if (!user) {
                try { user = await client.users.fetch(row.user_id); } catch (_) { }
            }
            const name = user ? (user.globalName || user.username) : "Unknown User";
            const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
            return `${medal} **${name}** — Lv.${row.level} | ${row.xp.toLocaleString()} XP`;
        }));

        const embed = new EmbedBuilder()
            .setTitle(`🏆 XPランキング — ${interaction.guild.name}`)
            .setDescription(rows.join("\n"))
            .setColor(0xFFD700)
            .setFooter({ text: `全期間の累計XPに基づくランキングです` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}
