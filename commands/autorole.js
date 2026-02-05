import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("自動付与ロールの設定")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("set")
            .setDescription("自動付与するロールを設定")
            .addRoleOption(opt => opt.setName("role").setDescription("付与するロール").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("off")
            .setDescription("自動付与を無効化")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "set") {
        const role = interaction.options.getRole("role");

        // Upsert
        const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [guildId]);
        if (check.rows.length === 0) {
            await dbQuery("INSERT INTO settings (guild_id, autorole_id, autorole_enabled) VALUES ($1, $2, TRUE)", [guildId, role.id]);
        } else {
            await dbQuery("UPDATE settings SET autorole_id = $1, autorole_enabled = TRUE WHERE guild_id = $2", [role.id, guildId]);
        }

        await interaction.reply({ content: `✅ 自動付与ロールを <@&${role.id}> に設定しました。` });
    }

    if (sub === "off") {
        await dbQuery("UPDATE settings SET autorole_enabled = FALSE WHERE guild_id = $1", [guildId]);
        await interaction.reply({ content: "✅ 自動ロール付与を無効化しました。" });
    }
}
