import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("サポートチケットシステムを管理します。")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("setup")
            .setDescription("チケット作成用パネルを設置します。")
            .addChannelOption(opt => opt.setName("channel").setDescription("パネルを設置するチャンネル").addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addStringOption(opt => opt.setName("title").setDescription("パネルのタイトル").setRequired(false))
            .addStringOption(opt => opt.setName("description").setDescription("パネルの説明文").setRequired(false))
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "setup") {
        const targetChannel = interaction.options.getChannel("channel");
        const title = interaction.options.getString("title") || "🎫 サポートチケット";
        const description = interaction.options.getString("description") || "お問い合わせや報告がある場合は、下のボタンを押してチケットを作成してください。専用のチャンネルが作成されます。";

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x00FF00)
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("ticket_create")
                .setLabel("チケットを作成")
                .setEmoji("🎫")
                .setStyle(ButtonStyle.Primary)
        );

        await targetChannel.send({ embeds: [embed], components: [row] });
        await interaction.reply({ content: `✅ パネルを <#${targetChannel.id}> に設置しました。`, ephemeral: true });
    }
}
