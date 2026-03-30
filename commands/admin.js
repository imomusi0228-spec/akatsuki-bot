import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { ENV } from "../config/env.js";
import { t } from "../core/i18n.js";

export const data = new SlashCommandBuilder()
    .setName("admin")
    .setNameLocalizations({
        ja: "管理画面",
        "en-US": "admin",
        "en-GB": "admin",
    })
    .setDescription("Generates a link to the Web Admin Dashboard.")
    .setDescriptionLocalizations({
        ja: "Web管理画面へのリンクを発行します。",
        "en-US": "Generates a link to the Web Admin Dashboard.",
        "en-GB": "Generates a link to the Web Admin Dashboard.",
    })
    .setDefaultMemberPermissions(0x0000000000000020); // PermissionFlagsBits.ManageGuild

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const baseUrl = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;

    const embed = new EmbedBuilder()
        .setTitle(`🏰 ${t("admin_title", locale)}`)
        .setDescription(t("subtitle", locale))
        .setColor(0x00ba7c)
        .addFields(
            {
                name: `📊 ${t("dashboard", locale)}`,
                value: `[${t("dashboard_loading", locale)}](${baseUrl}/admin/dashboard?guild=${interaction.guildId})`,
                inline: true,
            },
            {
                name: `⚙️ ${t("settings", locale)}`,
                value: `[${t("ng_word_settings", locale)}](${baseUrl}/admin/settings?guild=${interaction.guildId})`,
                inline: true,
            },
            {
                name: `🛡️ ${t("nav_antiraid", locale)}`,
                value: `[${t("ar_title", locale)}](${baseUrl}/admin/antiraid?guild=${interaction.guildId})`,
                inline: true,
            },
            {
                name: `🎫 ${t("ticket_mgmt", locale)}`,
                value: `[${t("ticket_mgmt_title", locale)}](${baseUrl}/admin/tickets?guild=${interaction.guildId})`,
                inline: true,
            },
            {
                name: `🤖 ${t("ai_insight_title", locale)}`,
                value: `[${t("ai_insight_title", locale)}](${baseUrl}/admin/ai?guild=${interaction.guildId})`,
                inline: true,
            },
            {
                name: `🎨 ${t("branding", locale)}`,
                value: `[${t("branding_title", locale)}](${baseUrl}/admin/branding?guild=${interaction.guildId})`,
                inline: true,
            }
        )
        .setFooter({
            text:
                locale === "ja"
                    ? "※管理機能の統合に伴い、各種設定コマンドはこちらに集約されました。"
                    : "Admin features are unified here as per instructions.",
        });

    await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral],
    });
}
