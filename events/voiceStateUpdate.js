import { Events, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { sendLog } from "../core/logger.js";

export default {
    name: Events.VoiceStateUpdate,
    async default(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const guild = newState.guild || oldState.guild;
        const guildId = guild.id;
        const userId = member.id;

        try {
            // Join
            if (!oldState.channelId && newState.channelId) {
                await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, join_time) 
                    VALUES ($1, $2, NOW())
                `, [guildId, userId]);

                const embed = new EmbedBuilder()
                    .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                    .setColor(0x00FF00)
                    .setDescription(`📥 入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, 'vc', embed);
            }

            // Leave (or Move)
            if (oldState.channelId) {
                const res = await dbQuery(`
                    SELECT id, join_time FROM vc_sessions 
                    WHERE guild_id = $1 AND user_id = $2 AND leave_time IS NULL 
                    ORDER BY join_time DESC LIMIT 1
                `, [guildId, userId]);

                if (res.rows.length > 0) {
                    const session = res.rows[0];
                    const endTime = new Date();
                    const durationSec = Math.floor((endTime - new Date(session.join_time)) / 1000);

                    await dbQuery(`
                        UPDATE vc_sessions 
                        SET leave_time = $1, duration_seconds = $2 
                        WHERE id = $3
                    `, [endTime, durationSec, session.id]);

                    // Only log [OUT] if they actually left or moved
                    if (!newState.channelId || oldState.channelId !== newState.channelId) {
                        const minutes = Math.floor(durationSec / 60);
                        const seconds = durationSec % 60;
                        const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;

                        const embed = new EmbedBuilder()
                            .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                            .setColor(0xFF0000)
                            .setDescription(`📤 退室: **#${oldState.channel.name}**\n⌛ 滞在時間: **${durationStr}**`)
                            .setTimestamp();

                        await sendLog(guild, 'vc', embed);
                    }
                }
            }

            // Move (Join part)
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, join_time) 
                    VALUES ($1, $2, NOW())
                `, [guildId, userId]);

                const embed = new EmbedBuilder()
                    .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                    .setColor(0x00FF00)
                    .setDescription(`📥 移動入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, 'vc', embed);
            }

        } catch (e) {
            console.error("VoiceStateUpdate Error:", e);
        }
    },
};
