import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { cache } from "../core/cache.js";

export default {
    name: Events.VoiceStateUpdate,
    async default(oldState, newState) {
        const member = newState.member || oldState.member;
        if (!member || member.user.bot) return;

        const guild = newState.guild || oldState.guild;
        const guildId = guild.id;
        const userId = member.id;

        const tier = await getTier(guildId);
        const features = getFeatures(tier);

        // VC Log restriction
        if (!features.vcLog) return;

        try {
            // Join
            if (!oldState.channelId && newState.channelId) {
                const joinTime = new Date();
                const sessionRes = await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, channel_id, join_time) 
                    VALUES ($1, $2, $3, $4) RETURNING id
                `, [guildId, userId, newState.channelId, joinTime]);

                if (sessionRes.rows.length > 0) {
                    cache.setActiveSession(guildId, userId, { id: sessionRes.rows[0].id, join_time: joinTime });
                }

                const { EmbedBuilder } = await import("discord.js");
                const { sendLog } = await import("../core/logger.js");

                const embed = new EmbedBuilder()
                    .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                    .setColor(0x00FF00)
                    .setDescription(`📥 入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, 'vc_in', embed);
            }

            // Leave (or Move)
            if (oldState.channelId) {
                // Try cache first
                let session = cache.getActiveSession(guildId, userId);

                if (!session) {
                    // Fallback to DB (needed after restart or if cache evicted)
                    const res = await dbQuery(`
                        SELECT id, join_time FROM vc_sessions 
                        WHERE guild_id = $1 AND user_id = $2 AND leave_time IS NULL 
                        ORDER BY join_time DESC LIMIT 1
                    `, [guildId, userId]);
                    if (res.rows.length > 0) session = res.rows[0];
                }

                if (session) {
                    const endTime = new Date();
                    const durationSec = Math.floor((endTime - new Date(session.join_time)) / 1000);

                    await dbQuery(`
                        UPDATE vc_sessions 
                        SET leave_time = $1, duration_seconds = $2 
                        WHERE id = $3
                    `, [endTime, durationSec, session.id]);

                    cache.clearActiveSession(guildId, userId);

                    // Update member_stats (Minutes & XP)
                    const minutesAdded = Math.floor(durationSec / 60);
                    const xpFromVc = minutesAdded * (Math.floor(Math.random() * 5) + 8); // 8-12 XP per minute

                    const currentStats = await dbQuery("SELECT xp, level FROM member_stats WHERE guild_id = $1 AND user_id = $2", [guildId, userId]);
                    const currentXp = (currentStats.rows[0]?.xp || 0) + xpFromVc;
                    let currentLevel = currentStats.rows[0]?.level || 1;
                    const nextLevelXp = currentLevel * currentLevel * 100;

                    let levelUp = false;
                    if (currentXp >= nextLevelXp) {
                        currentLevel++;
                        levelUp = true;
                    }

                    await dbQuery(`
                        INSERT INTO member_stats (guild_id, user_id, total_vc_minutes, xp, level, last_activity_at)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                        ON CONFLICT (guild_id, user_id) DO UPDATE SET 
                        total_vc_minutes = member_stats.total_vc_minutes + EXCLUDED.total_vc_minutes,
                        xp = EXCLUDED.xp,
                        level = EXCLUDED.level,
                        last_activity_at = EXCLUDED.last_activity_at
                    `, [guildId, userId, minutesAdded, currentXp, currentLevel]).catch(() => { });

                    if (levelUp) {
                        try {
                            const systemChannel = guild.systemChannel || (await guild.channels.fetch().then(cs => cs.find(c => c.type === ChannelType.GuildText)));
                            if (systemChannel) {
                                await systemChannel.send(`🎉 <@${userId}> さん、レベルアップ！ **Level ${currentLevel}** になりました！（VC滞在ボーナス）`);
                            }
                        } catch (e) { }
                    }


                    // Only log [OUT] if they actually left or moved
                    if (!newState.channelId || oldState.channelId !== newState.channelId) {
                        const minutes = Math.floor(durationSec / 60);
                        const seconds = durationSec % 60;
                        const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;

                        const { EmbedBuilder } = await import("discord.js");
                        const { sendLog } = await import("../core/logger.js");

                        const embed = new EmbedBuilder()
                            .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                            .setColor(0xFF0000)
                            .setDescription(`📤 退室: **#${oldState.channel.name}**\n⌛ 滞在時間: **${durationStr}**`)
                            .setTimestamp();

                        await sendLog(guild, 'vc_out', embed);
                    }
                }
            }

            // Move (Join part)
            if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                const joinTime = new Date();
                const sessionRes = await dbQuery(`
                    INSERT INTO vc_sessions (guild_id, user_id, channel_id, join_time) 
                    VALUES ($1, $2, $3, $4) RETURNING id
                `, [guildId, userId, newState.channelId, joinTime]);

                if (sessionRes.rows.length > 0) {
                    cache.setActiveSession(guildId, userId, { id: sessionRes.rows[0].id, join_time: joinTime });
                }

                const { EmbedBuilder } = await import("discord.js");
                const { sendLog } = await import("../core/logger.js");

                const embed = new EmbedBuilder()
                    .setAuthor({ name: member.displayName, iconURL: member.user.displayAvatarURL() })
                    .setColor(0x00FF00)
                    .setDescription(`📥 移動入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, 'vc_in', embed);
            }

        } catch (e) {
            console.error("VoiceStateUpdate Error:", e);
        }
    },
};
