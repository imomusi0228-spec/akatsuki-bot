import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { batcher } from "../core/batcher.js";

export default {
    name: Events.GuildMemberRemove,
    async default(member) {
        if (member.user.bot) return;

        try {
            // Batched Insert
            batcher.push('member_events', { guild_id: member.guild.id, user_id: member.user.id, event_type: 'leave' });
            console.log(`[EVENT] Member Left: ${member.user.tag} from ${member.guild.name}`);
        } catch (e) {
            console.error("[EVENT ERROR] GuildMemberRemove:", e.message);
        }
    },
};
