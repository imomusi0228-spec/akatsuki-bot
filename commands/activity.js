import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { ENV } from "../config/env.js";

export const data = new SlashCommandBuilder()
    .setName("activity")
    .setDescription("アクティビティチェック（Web機能）")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
    const url = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;
    await interaction.reply({
        content: `アクティビティの確認や詳細なフィルタリングはWeb管理画面で行ってください。\n👉 ${url}/admin/activity`,
        ephemeral: true
    });
}
