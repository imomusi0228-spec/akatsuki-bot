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
    .setDescription("Deploys a ticket creation panel.")
    .setDescriptionLocalizations({
        ja: "チケット作成用パネルを設置します。",
        "en-US": "Deploys a ticket creation panel.",
        "en-GB": "Deploys a ticket creation panel.",
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const guildId = interaction.guild.id;

    const targetChannel = interaction.channel;
    const settingsRes = await dbQuery("SELECT ticket_panel_title, ticket_panel_desc FROM settings WHERE guild_id = $1", [guildId]);
    const settings = settingsRes.rows[0];

    const title =
        settings?.ticket_panel_title ||
        (locale === "ja" ? "🎫 サポートチケット" : "🎫 Support Ticket");
    const description =
        settings?.ticket_panel_desc ||
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
