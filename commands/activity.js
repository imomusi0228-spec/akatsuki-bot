import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { ENV } from "../config/env.js";

export const data = new SlashCommandBuilder()
    .setName("activity")
    .setDescription("Bot機能の詳細を確認")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const url = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;
    await interaction.reply({
        content: `Bot機能の詳細はこちらで確認できます。\n👉 ${url}/features`,
        ephemeral: true
    });
}
