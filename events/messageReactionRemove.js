import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";

export default {
    name: Events.MessageReactionRemove,
    async default(reaction, user) {
        if (user.bot) return;
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error("Something went wrong when fetching the reaction:", error);
                return;
            }
        }

        const { guild } = reaction.message;
        if (!guild) return;

        const res = await dbQuery(
            "SELECT role_id FROM reaction_roles WHERE guild_id = $1 AND message_id = $2 AND emoji = $3",
            [guild.id, reaction.message.id, reaction.emoji.toString()]
        );

        if (res.rows.length > 0) {
            const member = await guild.members.fetch(user.id);
            for (const row of res.rows) {
                try {
                    await member.roles.remove(row.role_id);
                } catch (e) {
                    console.error(
                        `Failed to remove role ${row.role_id} from ${user.tag}:`,
                        e.message
                    );
                }
            }
        }
    },
};
