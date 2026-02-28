import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
} from "discord.js";
import { dbQuery } from "../core/db.js";
import { t } from "../core/i18n.js";

export const data = new SlashCommandBuilder()
    .setName("ticket")
    .setNameLocalizations({ ja: "チケット", "en-US": "ticket", "en-GB": "ticket" })
    .setDescription("Manages the support ticket system.")
    .setDescriptionLocalizations({
        ja: "サポートチケットシステムを管理します。",
        "en-US": "Manages the support ticket system.",
        "en-GB": "Manages the support ticket system.",
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
        sub
            .setName("setup")
            .setNameLocalizations({ ja: "セットアップ", "en-US": "setup", "en-GB": "setup" })
            .setDescription("Deploys a ticket creation panel.")
            .setDescriptionLocalizations({
                ja: "チケット作成用パネルを設置します。",
                "en-US": "Deploys a ticket creation panel.",
                "en-GB": "Deploys a ticket creation panel.",
            })
            .addChannelOption((opt) =>
                opt
                    .setName("channel")
                    .setNameLocalizations({
                        ja: "チャンネル",
                        "en-US": "channel",
                        "en-GB": "channel",
                    })
                    .setDescription("The channel to deploy the panel.")
                    .setDescriptionLocalizations({
                        ja: "パネルを設置するチャンネル",
                        "en-US": "The channel to deploy the panel.",
                        "en-GB": "The channel to deploy the panel.",
                    })
                    .addChannelTypes(ChannelType.GuildText)
                    .setRequired(true)
            )
            .addStringOption((opt) =>
                opt
                    .setName("title")
                    .setNameLocalizations({ ja: "タイトル", "en-US": "title", "en-GB": "title" })
                    .setDescription("The panel title (optional).")
                    .setDescriptionLocalizations({
                        ja: "パネルのタイトル",
                        "en-US": "The panel title (optional).",
                        "en-GB": "The panel title (optional).",
                    })
                    .setRequired(false)
            )
            .addStringOption((opt) =>
                opt
                    .setName("description")
                    .setNameLocalizations({
                        ja: "説明",
                        "en-US": "description",
                        "en-GB": "description",
                    })
                    .setDescription("The panel description (optional).")
                    .setDescriptionLocalizations({
                        ja: "パネルの説明文",
                        "en-US": "The panel description (optional).",
                        "en-GB": "The panel description (optional).",
                    })
                    .setRequired(false)
            )
    );

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "setup") {
        const targetChannel = interaction.options.getChannel("channel");
        const title =
            interaction.options.getString("title") ||
            (locale === "ja" ? "🎫 サポートチケット" : "🎫 Support Ticket");
        const description =
            interaction.options.getString("description") ||
            (locale === "ja"
                ? "お問い合わせや報告がある場合は、下のボタンを押してチケットを作成してください。専用のチャンネルが作成されます。"
                : "If you have an inquiry or report, please press the button below to create a ticket. A dedicated channel will be created.");

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x00ff00)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_create")
                .setLabel(locale === "ja" ? "チケットを作成" : "Create Ticket")
                .setEmoji("🎫")
                .setStyle(ButtonStyle.Primary)
        );

        await targetChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({
            content:
                locale === "ja"
                    ? `✅ パネルを <#${targetChannel.id}> に設置しました。`
                    : `✅ Panel deployed to <#${targetChannel.id}>.`,
            ephemeral: true,
        });
    }
}
