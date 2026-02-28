import { Events, ChannelType, PermissionFlagsBits } from "discord.js";
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

        try {
            // --- Auto-VC Logic (Category-based) ---
            const settingsRes = await dbQuery(
                "SELECT auto_vc_creator_id FROM settings WHERE guild_id = $1",
                [guildId]
            );
            const categoryId = settingsRes.rows[0]?.auto_vc_creator_id;

            if (categoryId && newState.channel && newState.channel.parentId === categoryId) {
                // Find the top-most voice channel in this category
                const categoryChannels = guild.channels.cache
                    .filter((c) => c.parentId === categoryId && c.type === ChannelType.GuildVoice)
                    .sort((a, b) => a.position - b.position);

                let triggerChannel = categoryChannels.first();

                // Proactive creation if NONE exist in category
                if (!triggerChannel) {
                    triggerChannel = await guild.channels.create({
                        name: "➕ 部屋作成",
                        type: ChannelType.GuildVoice,
                        parent: categoryId,
                    });
                    console.log(`[AUTO-VC] Restored missing trigger in category ${categoryId}`);
                }

                // 1. Create VC when joining the top-most (trigger) channel
                if (
                    triggerChannel &&
                    newState.channelId === triggerChannel.id &&
                    oldState.channelId !== triggerChannel.id
                ) {
                    const newChannel = await guild.channels.create({
                        name: `🔊 ${member.displayName}の部屋`,
                        type: ChannelType.GuildVoice,
                        parent: categoryId,
                        permissionOverwrites: [
                            {
                                id: guild.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.Connect,
                                ],
                            },
                        ],
                    });

                    await dbQuery(
                        "INSERT INTO auto_vc_channels (channel_id, guild_id, owner_id) VALUES ($1, $2, $3)",
                        [newChannel.id, guildId, userId]
                    );
                    await member.voice.setChannel(newChannel).catch(() => {});
                    console.log(
                        `[AUTO-VC] Created room for ${member.user.tag} in category ${categoryId}: ${newChannel.name}`
                    );
                }
            }

            // 2. Cleanup / Transfer when leaving
            if (oldState.channelId && oldState.channelId !== newState.channelId) {
                const autoVcRes = await dbQuery(
                    "SELECT * FROM auto_vc_channels WHERE channel_id = $1",
                    [oldState.channelId]
                );
                if (autoVcRes.rows.length > 0) {
                    const room = autoVcRes.rows[0];
                    const oldChannel = oldState.channel;

                    if (oldChannel) {
                        if (oldChannel.members.size === 0) {
                            // Empty: Delete
                            await oldChannel.delete().catch(() => {});
                            await dbQuery("DELETE FROM auto_vc_channels WHERE channel_id = $1", [
                                oldState.channelId,
                            ]);
                            console.log(`[AUTO-VC] Deleted empty room: ${oldChannel.name}`);
                        } else if (room.owner_id === userId) {
                            // Owner left: Transfer to oldest member
                            const nextOwner = oldChannel.members.first(); // Discord.js Collection ordered by join order (cached)
                            if (nextOwner) {
                                await dbQuery(
                                    "UPDATE auto_vc_channels SET owner_id = $1 WHERE channel_id = $2",
                                    [nextOwner.id, oldState.channelId]
                                );
                                await oldChannel
                                    .setName(`🔊 ${nextOwner.displayName}の部屋`)
                                    .catch(() => {});
                                await oldChannel
                                    .send(
                                        `👑 オーナーが退出したため、新しく <@${nextOwner.id}> さんがこの部屋の主（オーナー）となりました。`
                                    )
                                    .catch(() => {});
                                console.log(
                                    `[AUTO-VC] Transferred owner in ${oldChannel.name} to ${nextOwner.user.tag}`
                                );
                            }
                        }
                    }
                }
            }

            // --- VC Logging & Stats (Existing) ---
            if (!features.vcLog) return;

            // Join
            if (!oldState.channelId && newState.channelId) {
                const joinTime = new Date();
                const sessionRes = await dbQuery(
                    `
                    INSERT INTO vc_sessions (guild_id, user_id, channel_id, join_time) 
                    VALUES ($1, $2, $3, $4) RETURNING id
                `,
                    [guildId, userId, newState.channelId, joinTime]
                );

                if (sessionRes.rows.length > 0) {
                    cache.setActiveSession(guildId, userId, {
                        id: sessionRes.rows[0].id,
                        join_time: joinTime,
                    });
                }

                const { EmbedBuilder } = await import("discord.js");
                const { sendLog } = await import("../core/logger.js");

                const embed = new EmbedBuilder()
                    .setAuthor({
                        name: member.displayName,
                        iconURL: member.user.displayAvatarURL(),
                    })
                    .setColor(0x00ff00)
                    .setDescription(`📥 入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, "vc_in", embed);
            }

            // Leave (or Move)
            if (oldState.channelId) {
                // Try cache first
                let session = cache.getActiveSession(guildId, userId);

                if (!session) {
                    const res = await dbQuery(
                        `
                        SELECT id, join_time FROM vc_sessions 
                        WHERE guild_id = $1 AND user_id = $2 AND leave_time IS NULL 
                        ORDER BY join_time DESC LIMIT 1
                    `,
                        [guildId, userId]
                    );
                    if (res.rows.length > 0) session = res.rows[0];
                }

                if (session) {
                    const endTime = new Date();
                    const durationSec = Math.floor((endTime - new Date(session.join_time)) / 1000);

                    await dbQuery(
                        `
                        UPDATE vc_sessions 
                        SET leave_time = $1, duration_seconds = $2 
                        WHERE id = $3
                    `,
                        [endTime, durationSec, session.id]
                    );

                    cache.clearActiveSession(guildId, userId);

                    const minutesAdded = Math.floor(durationSec / 60);
                    const xpFromVc = minutesAdded * (Math.floor(Math.random() * 11) + 15);

                    const currentStats = await dbQuery(
                        "SELECT xp, level FROM member_stats WHERE guild_id = $1 AND user_id = $2",
                        [guildId, userId]
                    );
                    const currentXp = (currentStats.rows[0]?.xp || 0) + xpFromVc;
                    let currentLevel = currentStats.rows[0]?.level || 1;
                    const nextLevelXp = currentLevel * currentLevel * 80;

                    let levelUp = false;
                    if (currentXp >= nextLevelXp) {
                        currentLevel++;
                        levelUp = true;
                    }

                    await dbQuery(
                        `
                        INSERT INTO member_stats (guild_id, user_id, total_vc_minutes, xp, level, last_activity_at)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                        ON CONFLICT (guild_id, user_id) DO UPDATE SET 
                        total_vc_minutes = member_stats.total_vc_minutes + EXCLUDED.total_vc_minutes,
                        xp = EXCLUDED.xp,
                        level = EXCLUDED.level,
                        last_activity_at = EXCLUDED.last_activity_at
                    `,
                        [guildId, userId, minutesAdded, currentXp, currentLevel]
                    ).catch(() => {});

                    if (levelUp) {
                        try {
                            const systemChannel =
                                guild.systemChannel ||
                                (await guild.channels
                                    .fetch()
                                    .then((cs) =>
                                        cs.find((c) => c.type === ChannelType.GuildText)
                                    ));
                            if (systemChannel) {
                                await systemChannel.send(
                                    `🎉 <@${userId}> さん、レベルアップ！ **Level ${currentLevel}** になりました！（VC滞在ボーナス）`
                                );
                            }
                        } catch (e) {}
                    }

                    if (!newState.channelId || oldState.channelId !== newState.channelId) {
                        const minutes = Math.floor(durationSec / 60);
                        const seconds = durationSec % 60;
                        const durationStr =
                            minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;

                        const { EmbedBuilder } = await import("discord.js");
                        const { sendLog } = await import("../core/logger.js");

                        const embed = new EmbedBuilder()
                            .setAuthor({
                                name: member.displayName,
                                iconURL: member.user.displayAvatarURL(),
                            })
                            .setColor(0xff0000)
                            .setDescription(
                                `📤 退室: **#${oldState.channel.name}**\n⌛ 滞在時間: **${durationStr}**`
                            )
                            .setTimestamp();

                        await sendLog(guild, "vc_out", embed);
                    }
                }
            }

            // Move (Join part)
            if (newState.channelId && oldState.channelId !== newState.channelId) {
                // Check if it's the creator channel (redundant but safe)
                if (newState.channelId === creatorId) return; // Handled by create logic

                const joinTime = new Date();
                const sessionRes = await dbQuery(
                    `
                    INSERT INTO vc_sessions (guild_id, user_id, channel_id, join_time) 
                    VALUES ($1, $2, $3, $4) RETURNING id
                `,
                    [guildId, userId, newState.channelId, joinTime]
                );

                if (sessionRes.rows.length > 0) {
                    cache.setActiveSession(guildId, userId, {
                        id: sessionRes.rows[0].id,
                        join_time: joinTime,
                    });
                }

                const { EmbedBuilder } = await import("discord.js");
                const { sendLog } = await import("../core/logger.js");

                const embed = new EmbedBuilder()
                    .setAuthor({
                        name: member.displayName,
                        iconURL: member.user.displayAvatarURL(),
                    })
                    .setColor(0x00ff00)
                    .setDescription(`📥 移動入室: **#${newState.channel.name}**`)
                    .setTimestamp();

                await sendLog(guild, "vc_in", embed);
            }
        } catch (e) {
            console.error("VoiceStateUpdate Error:", e);
        }
    },
};
