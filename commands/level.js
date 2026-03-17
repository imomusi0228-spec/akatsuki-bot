import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { t } from "../core/i18n.js";

export const data = new SlashCommandBuilder()
    .setName("level")
    .setNameLocalizations({
        ja: "レベル",
        "en-US": "level",
        "en-GB": "level",
    })
    .setDescription("Level and XP related commands")
    .setDescriptionLocalizations({
        ja: "レベル・XP関連のコマンド",
        "en-US": "Level and XP related commands",
        "en-GB": "Level and XP related commands",
    })
    .addSubcommand((sub) =>
        sub
            .setName("rank")
            .setNameLocalizations({ ja: "ランク", "en-US": "rank", "en-GB": "rank" })
            .setDescription("Displays current level and XP for you or a designated user.")
            .setDescriptionLocalizations({
                ja: "自分または指定ユーザーの現在のレベルとXPを表示します。",
                "en-US": "Displays current level and XP for you or a designated user.",
                "en-GB": "Displays current level and XP for you or a designated user.",
            })
            .addUserOption((opt) =>
                opt
                    .setName("user")
                    .setNameLocalizations({ ja: "ユーザー", "en-US": "user", "en-GB": "user" })
                    .setDescription("The user to check.")
                    .setDescriptionLocalizations({
                        ja: "確認するユーザー",
                        "en-US": "The user to check.",
                        "en-GB": "The user to check.",
                    })
                    .setRequired(false)
            )
    )
    .addSubcommand((sub) =>
        sub
            .setName("leaderboard")
            .setNameLocalizations({
                ja: "ランキング",
                "en-US": "leaderboard",
                "en-GB": "leaderboard",
            })
            .setDescription("Displays the top 10 XP rankings for this server.")
            .setDescriptionLocalizations({
                ja: "このサーバーのXPランキングトップ10を表示します。",
                "en-US": "Displays the top 10 XP rankings for this server.",
                "en-GB": "Displays the top 10 XP rankings for this server.",
            })
    );

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    const setRes = await dbQuery("SELECT leaderboard_enabled FROM settings WHERE guild_id = $1", [
        guildId,
    ]);
    const leaderboardEnabled = setRes.rows[0]?.leaderboard_enabled !== false;

    if (sub === "rank") {
        const target = interaction.options.getUser("user") || interaction.user;
        const res = await dbQuery(
            "SELECT xp, level, total_vc_minutes, message_count FROM member_stats WHERE guild_id = $1 AND user_id = $2",
            [guildId, target.id]
        );

        if (res.rows.length === 0) {
            return interaction.reply({
                content: `ℹ️ ${t("no_guilds", locale)} (${target.username})`,
                ephemeral: true,
            });
        }

        const { xp, level, total_vc_minutes, message_count } = res.rows[0];
        const nextLevelXp = level * level * 100;
        const progress = Math.min(100, Math.floor((xp / nextLevelXp) * 100));

        const barSize = 10;
        const filled = Math.floor(progress / (100 / barSize));
        const bar = "🟦".repeat(filled) + "⬜".repeat(barSize - filled);

        const rankRes = await dbQuery(
            "SELECT COUNT(*) as cnt FROM member_stats WHERE guild_id = $1 AND xp > $2",
            [guildId, xp]
        );
        const rankNum = parseInt(rankRes.rows[0]?.cnt || 0) + 1;

        const embed = new EmbedBuilder()
            .setAuthor({ name: target.displayName, iconURL: target.displayAvatarURL() })
            .setTitle(`🌟 ${t("level_stats_title", locale)}`)
            .setColor(0x00a2e8)
            .addFields(
                { name: t("status", locale), value: `**#${rankNum}**`, inline: true },
                { name: t("plan_badge_std", locale), value: `**Lv. ${level}**`, inline: true },
                {
                    name: "XP",
                    value: `${xp.toLocaleString()} / ${nextLevelXp.toLocaleString()}`,
                    inline: true,
                },
                { name: locale === "ja" ? "進捗" : "Progress", value: `${bar} (${progress}%)` },
                {
                    name: locale === "ja" ? "統計" : "Stats",
                    value: `💬 ${t("messages_count", locale)}: ${(message_count || 0).toLocaleString()}\n🎙️ VC: ${(total_vc_minutes || 0).toLocaleString()}${t("none", locale)}`,
                }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    } else if (sub === "leaderboard") {
        if (!leaderboardEnabled) {
            return interaction.reply({
                content: `❌ ${t("leaderboard_help", locale).split("。")[0]}`,
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        const statsRes = await dbQuery(
            "SELECT user_id, xp, level, message_count, total_vc_minutes FROM member_stats WHERE guild_id = $1 ORDER BY xp DESC LIMIT 10",
            [guildId]
        );

        if (statsRes.rows.length === 0) {
            return interaction.editReply(`📊 ${t("ng_none", locale)}`);
        }

        const rows = await Promise.all(
            statsRes.rows.map(async (row, i) => {
                let user = client.users.cache.get(row.user_id);
                if (!user) {
                    try {
                        user = await client.users.fetch(row.user_id);
                    } catch (_) {}
                }
                const name = user ? user.globalName || user.username : "Unknown User";
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
                return `${medal} **${name}** — Lv.${row.level} | ${row.xp.toLocaleString()} XP`;
            })
        );

        const embed = new EmbedBuilder()
            .setTitle(
                `🏆 ${t("leaderboard_title", locale, { count: 10 })} — ${interaction.guild.name}`
            )
            .setDescription(rows.join("\n"))
            .setColor(0xffd700)
            .setFooter({
                text:
                    locale === "ja"
                        ? "全期間の累計XPに基づくランキングです"
                        : "Rankings based on cumulative all-time XP.",
            })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}
