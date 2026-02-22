import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { cache } from "../core/cache.js";
import { batcher } from "../core/batcher.js";

export default {
    name: Events.MessageCreate,
    async default(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        try {
            // Track Activity
            dbQuery(`
                INSERT INTO member_stats (guild_id, user_id, last_activity_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (guild_id, user_id) DO UPDATE SET last_activity_at = NOW()
            `, [message.guild.id, message.author.id]).catch(() => { });

            // Spam Protection (Similarity-based)
            const tier = await getTier(message.guild.id);

            const features = getFeatures(tier);

            if (features.spamProtection || features.antiraid) {
                const {
                    checkSpam, checkMentionSpam, checkRateLimit,
                    checkGlobalSpam, checkSuspiciousContent, isMemberRestricted
                } = await import("../core/protection.js");

                let settings = cache.getSettings(message.guild.id);
                if (!settings) {
                    const res = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                    settings = res.rows[0] || {};
                    cache.setSettings(message.guild.id, settings);
                }

                // 1. Content Similarity Spam
                const spamCheck = checkSpam(message.guild.id, message.author.id, message.content);

                // 2. Mention Spam
                const mentionCount = message.mentions.users.size + message.mentions.roles.size;
                const mentionCheck = checkMentionSpam(message.guild.id, message.author.id, mentionCount);

                // 3. Rate Limit (Frequency)
                const rateCheck = checkRateLimit(message.guild.id, message.author.id);

                // 4. Global Spam (Cross-user identical messages)
                const globalCheck = checkGlobalSpam(message.guild.id, message.author.id, message.content);

                // 5. Newcomer / Account Age Restriction
                const isRestricted = isMemberRestricted(message.member, settings);

                // 6. Suspicious Content (Invites/Links/Density)
                const suspicious = checkSuspiciousContent(message.content, settings.domain_blacklist || []);

                if (spamCheck.isSpam || mentionCheck.isSpam || rateCheck.isSpam || globalCheck.isSpam || (isRestricted && settings.antiraid_guard_level >= 1) || suspicious.isSuspicious) {
                    const { EmbedBuilder } = await import("discord.js");
                    const { sendLog } = await import("../core/logger.js");

                    let action = "Delete";
                    let reason = "Spam/Security Violation";
                    let isRaid = globalCheck.isSpam || (isRestricted && settings.antiraid_guard_level >= 2);

                    if (spamCheck.isSpam) reason = "Similarity Spam";
                    else if (mentionCheck.isSpam) reason = "Mention Spam";
                    else if (rateCheck.isSpam) reason = "Rate Limit (Frequency)";
                    else if (globalCheck.isSpam) reason = "Global Raid Spam (Multiple Users)";
                    else if (isRestricted) reason = "Newcomer Restriction";
                    else if (suspicious.isSuspicious) reason = `Suspicious Content (${suspicious.reason})`;

                    // Delete the message
                    await message.delete().catch(() => { });

                    // High Severity Action: Kick
                    const count = Math.max(spamCheck.count || 0, mentionCheck.count || 0, rateCheck.count || 0, globalCheck.count || 0);

                    if (count >= 5 || isRaid) {
                        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
                        if (member) {
                            if (member.kickable && isRaid) {
                                await member.kick("Iron Fortress: Raid/Security Violation").catch(() => { });
                                action = "Kicked";
                            }
                        }
                    }

                    // Log to Admin Channel
                    if (features.ngLog) {
                        const embed = new EmbedBuilder()
                            .setAuthor({ name: message.member?.displayName || message.author.tag, iconURL: message.author.displayAvatarURL() })
                            .setColor(isRaid ? 0xFF0000 : 0xFFAA00)
                            .setTitle(`🛡️ Iron Fortress: ${reason}`)
                            .setDescription(`**ユーザー**: <@${message.author.id}>\n**コンテンツ**: ||${message.content.substring(0, 200)}||\n**アクション**: ${action}`)
                            .setTimestamp();
                        await sendLog(message.guild, 'ng', embed);
                    }
                    return;
                }
            }

            // Load NG words
            let ngWords = cache.getNgWords(message.guild.id);
            if (!ngWords) {
                const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [message.guild.id]);
                ngWords = res.rows;
                cache.setNgWords(message.guild.id, ngWords);
            }

            if (ngWords.length === 0) return;

            let caughtWords = [];
            for (const ng of ngWords) {
                if (ng.kind === "regex") {
                    if (ng.compiled && ng.compiled.test(message.content)) caughtWords.push(ng.word);
                } else {
                    if (message.content.includes(ng.word)) caughtWords.push(ng.word);
                }
            }

            if (caughtWords.length > 0) {
                // Delete message
                await message.delete().catch(() => { });

                // Fetch Settings
                let settings = cache.getSettings(message.guild.id);
                if (!settings) {
                    const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                    settings = settingsRes.rows[0] || {};
                    cache.setSettings(message.guild.id, settings);
                }

                const threshold = settings.ng_threshold || 3;
                const timeoutMin = settings.timeout_minutes || 10;

                console.log(`[DEBUG] Settings: threshold=${threshold}, timeout=${timeoutMin}m`);

                // Log EACH word to DB (Batched)
                for (const word of caughtWords) {
                    batcher.push('ng_logs', { guild_id: message.guild.id, user_id: message.author.id, user_name: message.author.tag, word });
                }

                const joinedWords = caughtWords.join(", ");

                // DM Warning
                try {
                    const warningMsg = `⚠️ **禁止ワードを検知しました / Restricted word detected**\n\n` +
                        `サーバー: **${message.guild.name}**\n` +
                        `対象ワード: ||${joinedWords}||\n` +
                        `メッセージを削除しました。 / Your message was removed.\n\n` +
                        `*繰り返し警告を無視すると、タイムアウトが適用される場合があります。*\n` +
                        `*Repeated violations may lead to a timeout.*`;
                    await message.author.send(warningMsg);
                } catch (e) { }

                // Check violations in last 1 hour
                const countRes = await dbQuery("SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '1 hour'",
                    [message.guild.id, message.author.id]);
                const count = parseInt(countRes.rows[0].cnt);

                let actionTaken = "Msg Deleted";

                // Timeout Execution
                if (count >= threshold) {
                    try {
                        const member = await message.guild.members.fetch(message.author.id);
                        if (member.moderatable) {
                            if (timeoutMin > 0) {
                                await member.timeout(timeoutMin * 60 * 1000, "NG Word Threshold Exceeded");

                                // Log Timeout to member_events (Batched)
                                batcher.push('member_events', { guild_id: message.guild.id, user_id: message.author.id, event_type: 'timeout' });

                                actionTaken = `Timeout (${timeoutMin}m)`;
                            }
                        } else {
                            actionTaken = "Msg Deleted (No Perm for Timeout)";
                        }
                    } catch (e) { }
                }

                // Log to Channel
                const tier = await getTier(message.guild.id);
                const features = getFeatures(tier);

                // Log to Channel
                if (features.ngLog) {
                    const { EmbedBuilder } = await import("discord.js");
                    const { sendLog } = await import("../core/logger.js");

                    const embed = new EmbedBuilder()
                        .setAuthor({ name: message.member?.displayName || message.author.tag, iconURL: message.author.displayAvatarURL() })
                        .setColor(0xFF0000)
                        .setTitle("🚨 NG Word Detected")
                        .setDescription(`**NGワード**: ||${joinedWords}||\n**本文**: ||${message.content}||`)
                        .setFooter({ text: `状況: ${actionTaken} (${count}/${threshold})` })
                        .setTimestamp();

                    await sendLog(message.guild, 'ng', embed);
                }
            }

            // 3. Automated Self-Introduction Gate (Pro+ Only)
            if (features.introGate && settings.self_intro_enabled && settings.intro_channel_id === message.channel.id) {
                const minLength = settings.self_intro_min_length || 10;

                if (message.content.length >= minLength) {
                    const roleId = settings.self_intro_role_id;
                    if (roleId) {
                        try {
                            const member = await message.guild.members.fetch(message.author.id);
                            if (!member.roles.cache.has(roleId)) {
                                await member.roles.add(roleId, "Automated Self-Intro Gate");
                                console.log(`[INTRO-GATE] Role assigned to ${message.author.tag}`);
                                await message.react("✅").catch(() => { });
                            }
                        } catch (e) {
                            console.error("[INTRO-GATE ERROR] Failed to assign role:", e.message);
                        }
                    }
                }
            }

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
