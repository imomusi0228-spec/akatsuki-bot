import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";

// Temp cache for join times to minimize DB writes on join (optimization)
// Actually, tracking directly in DB is safer for persistence across restarts?
// Let's stick to DB updates for robustness.

export default {
    name: Events.VoiceStateUpdate,
    async default(oldState, newState) {
        if (oldState.member.user.bot) return;
        const guildId = newState.guild.id || oldState.guild.id;
        const userId = newState.member.id;

        try {
            // Join
            if (!oldState.channelId && newState.channelId) {
                await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, join_time) 
                    VALUES ($1, $2, NOW())
                `, [guildId, userId]);
            }

            // Leave (or Move)
            // Note: Move is treated as Leave + Join in Djs? 
            // Often it triggers two events or one with both channels differ.
            // Simplified logic: If old channel exists, close session. If new channel exists, start session.

            if (oldState.channelId) {
                // Determine if there's an open session
                const res = await dbQuery(`
                    SELECT id, join_time FROM vc_sessions 
                    WHERE guild_id = $1 AND user_id = $2 AND leave_time IS NULL 
                    ORDER BY join_time DESC LIMIT 1
                `, [guildId, userId]);

                if (res.rows.length > 0) {
                    const session = res.rows[0];
                    const endTime = new Date();
                    const duration = Math.floor((endTime - new Date(session.join_time)) / 1000); // seconds

                    await dbQuery(`
                        UPDATE vc_sessions 
                        SET leave_time = $1, duration_seconds = $2 
                        WHERE id = $3
                    `, [endTime, duration, session.id]);
                }
            }

            // If moved (Leave old + Join new), handle Join part
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, join_time) 
                    VALUES ($1, $2, NOW())
                `, [guildId, userId]);
            }

        } catch (e) {
            console.error("VoiceStateUpdate Error:", e);
        }
    },
};
