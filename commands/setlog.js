import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("ログ送信先チャンネルの設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt => opt.setName("channel").setDescription("ログを送信するチャンネル").setRequired(true));

export async function execute(interaction) {
    const channel = interaction.options.getChannel("channel");
    const guildId = interaction.guild.id;

    // Build Upsert
    const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [guildId]);
    if (check.rows.length === 0) {
        await dbQuery("INSERT INTO settings (guild_id, log_channel_id) VALUES ($1, $2)", [guildId, channel.id]);
    } else {
        await dbQuery("UPDATE settings SET log_channel_id = $1 WHERE guild_id = $2", [channel.id, guildId]);
    }

    await interaction.reply({ content: `✅ ログ送信先を <#${channel.id}> に設定しました。` });
}
