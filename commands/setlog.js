import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("setlog")
    .setDescription("ログ送信先チャンネルの設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(opt => opt.setName("channel").setDescription("ログを送信するチャンネル").setRequired(true))
    .addStringOption(opt => opt.setName("type")
        .setDescription("設定するログの種類")
        .addChoices(
            { name: "VC入退出ログ", value: "vc" },
            { name: "NGワード検知ログ", value: "ng" }
        ));

export async function execute(interaction) {
    const channel = interaction.options.getChannel("channel");
    const type = interaction.options.getString("type") || "vc"; // Default to vc
    const guildId = interaction.guild.id;

    const column = type === "vc" ? "log_channel_id" : "ng_log_channel_id";
    const typeLabel = type === "vc" ? "VC入退出" : "NGワード検知";

    const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [guildId]);
    if (check.rows.length === 0) {
        await dbQuery(`INSERT INTO settings (guild_id, ${column}) VALUES ($1, $2)`, [guildId, channel.id]);
    } else {
        await dbQuery(`UPDATE settings SET ${column} = $1 WHERE guild_id = $2`, [channel.id, guildId]);
    }

    await interaction.reply({ content: `✅ ${typeLabel}ログの送信先を <#${channel.id}> に設定しました。` });
}
