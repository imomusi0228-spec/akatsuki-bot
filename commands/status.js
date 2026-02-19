import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, version as djsVersion } from "discord.js";
import { ENV } from "../config/env.js"; // Assuming ENV is needed, or we can just skip if not used directly
import fs from "node:fs"; // To read package.json

export const data = new SlashCommandBuilder()
    .setName("status")
    .setDescription("ボットの稼働状況を表示 (管理者のみ)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const sent = await interaction.reply({ content: "Pinging...", fetchReply: true });
    const ping = sent.createdTimestamp - interaction.createdTimestamp;

    // Uptime
    const uptimeSeconds = process.uptime();
    const days = Math.floor(uptimeSeconds / (3600 * 24));
    const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    const uptimeStr = `${days}d ${hours}h ${minutes}m ${seconds}s`;

    // Memory URL
    const memoryUsage = process.memoryUsage();
    const memoryUsed = (memoryUsage.heapUsed / 1024 / 1024).toFixed(2);

    // Version
    let packageVersion = "Unknown";
    try {
        const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
        packageVersion = pkg.version;
    } catch (e) {
        console.error("Failed to read package.json", e);
    }

    const embed = new EmbedBuilder()
        .setTitle("📊 System Status")
        .setColor(0x00FF00)
        .addFields(
            { name: "🏓 Ping", value: `Websocket: ${interaction.client.ws.ping}ms\nRoundtrip: ${ping}ms`, inline: true },
            { name: "⏱️ Uptime", value: `${uptimeStr}`, inline: true },
            { name: "💾 Memory", value: `${memoryUsed} MB`, inline: true },
            { name: "🤖 Version", value: `Bot: v${packageVersion}\nDiscord.js: v${djsVersion}\nNode: ${process.version}`, inline: false }
        )
        .setTimestamp();

    await interaction.editReply({ content: null, embeds: [embed] });
}
