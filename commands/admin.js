import { SlashCommandBuilder } from "discord.js";
import { ENV } from "../config/env.js";

export const data = new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Web管理画面のリンクを表示");

export async function execute(interaction) {
    const url = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;
    const token = ENV.ADMIN_TOKEN ? `?token=${ENV.ADMIN_TOKEN}` : ""; // Optional: expose admin token logic if desired, or just link to root

    // Better to just link to public root or dashboard, login handled there.
    // User requested "Link to open admin screen".

    await interaction.reply({
        content: `Web管理画面はこちらです:\n${url}/login`,
        ephemeral: true
    });
}
