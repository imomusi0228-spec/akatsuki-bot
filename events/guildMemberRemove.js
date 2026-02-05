import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.GuildMemberRemove,
    async default(member) {
        try {
            const res = await dbQuery("SELECT log_channel_id FROM settings WHERE guild_id = $1", [member.guild.id]);
            const logChannelId = res.rows[0]?.log_channel_id;

            if (logChannelId) {
                const channel = member.guild.channels.cache.get(logChannelId);
                if (channel) {
                    channel.send(`📤 **Member Left**: ${member.user.tag} (${member.id})`);
                }
            }
        } catch (e) {
            console.error("GuildMemberRemove Error:", e);
        }
    },
};
