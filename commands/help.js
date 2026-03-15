import { SlashCommandBuilder } from "discord.js";
import { t } from "../core/i18n.js";

export const data = new SlashCommandBuilder()
    .setName("help")
    .setNameLocalizations({
        ja: "ヘルプ",
        "en-US": "help",
        "en-GB": "help",
    })
    .setDescription("Displays the command list.")
    .setDescriptionLocalizations({
        ja: "コマンド一覧を表示します。",
        "en-US": "Displays the command list.",
        "en-GB": "Displays the command list.",
    });

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";

    // Build help text dynamically based on locale
    let helpText = `**🛠️ ${t("help_guide_title", locale)}**\n\n`;

    helpText += `**${t("help_cat_analytics", locale)}**\n`;
    helpText += `\`/vc-name\` : ${t("cmd_vc_name_desc", locale) || "VCの名前を変更"}\n`;
    helpText += `\`/vc-limit\` : ${t("cmd_vc_limit_desc", locale) || "VCの人数制限を変更"}\n`;
    helpText += `\`/level rank\` : ${t("cmd_level_desc", locale)}\n`;
    helpText += `\`/admin\` : ${t("view_features", locale)}\n\n`;

    helpText += `**${t("help_cat_admin", locale)}**\n`;
    helpText += `\`/admin\` : ${t("cmd_admin_desc", locale)}\n`;
    helpText += `*${t("admin_integrated_notice", locale) || "※各種設定（ログ、オーラ、NGワード等）はWeb管理画面に統合されました。"}*\n\n`;

    helpText += `**${t("help_cat_mod", locale)}**\n`;
    helpText += `\`/ticket setup\` : ${t("ticket_basic_settings", locale)}\n`;
    helpText += `\`/scan [type]\` : ${t("cmd_scan_desc", locale)}\n\n`;

    helpText += `**${t("help_cat_info", locale)}**\n`;
    helpText += `\`/help\` : ${t("cmd_help_desc", locale)}\n\n`;

    helpText += `*${t("help_footer", locale)}*`;

    await interaction.reply({ content: helpText });
}
