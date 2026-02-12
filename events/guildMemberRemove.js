import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.GuildMemberRemove,
    async default(member) {
        if (member.user.bot) return;

        try {
            await dbQuery(
                "INSERT INTO member_events (guild_id, user_id, event_type) VALUES ($1, $2, $3)",
                [member.guild.id, member.user.id, 'leave']
            );
            console.log(`[EVENT] Member Left: ${member.user.tag} from ${member.guild.name}`);
        } catch (e) {
            console.error("[EVENT ERROR] GuildMemberRemove:", e.message);
        }
    },
};
