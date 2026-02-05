import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.GuildMemberAdd,
    async default(member) {
        try {
            const res = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [member.guild.id]);
            const settings = res.rows[0];
            if (!settings) return;

            // Log
            if (settings.log_channel_id) {
                const channel = member.guild.channels.cache.get(settings.log_channel_id);
                if (channel) {
                    channel.send(`📥 **Member Joined**: ${member.user.tag} (${member.id})`);
                }
            }

            // Auto Role
            if (settings.autorole_enabled && settings.autorole_id) {
                const role = member.guild.roles.cache.get(settings.autorole_id);
                if (role) {
                    await member.roles.add(role).catch(e => {
                        console.error(`Failed to add auto role in ${member.guild.name}:`, e);
                        if (settings.log_channel_id) {
                            const ch = member.guild.channels.cache.get(settings.log_channel_id);
                            if (ch) ch.send(`⚠️ **Auto Role Failed**: Could not add role ${role.name} to ${member.user.tag}. Check permissions.`);
                        }
                    });
                }
            }

        } catch (e) {
            console.error("GuildMemberAdd Error:", e);
        }
    },
};
