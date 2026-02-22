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

                const phase2Threshold = settings.phase2_threshold ?? 3;
                const phase3Threshold = settings.phase3_threshold ?? 6;
                const phase4Threshold = settings.phase4_threshold ?? 10;
                const phase2Action = settings.phase2_action || 'timeout';
                const phase3Action = settings.phase3_action || 'kick';
                const phase4Action = settings.phase4_action || 'ban';
                const timeoutMin = settings.timeout_minutes || 10;

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
                        `*繰り返し警告を無視すると、タイムアウトが適用されます。*\n` +
                        `*Repeated violations may lead to escalating penalties.*`;
                    await message.author.send(warningMsg);
                } catch (e) { }

                // Count violations in last 1 hour
                const countRes = await dbQuery(
                    "SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '1 hour'",
                    [message.guild.id, message.author.id]
                );
                const count = parseInt(countRes.rows[0].cnt);

                let actionTaken = "Msg Deleted";

                const member = await message.guild.members.fetch(message.author.id).catch(() => null);
                if (member) {
                    const applyAction = async (action) => {
                        if (action === 'timeout' && member.moderatable) {
                            await member.timeout(timeoutMin * 60 * 1000, "NG Word Threshold Exceeded");
                            batcher.push('member_events', { guild_id: message.guild.id, user_id: message.author.id, event_type: 'timeout' });
                            actionTaken = `Timeout (${timeoutMin}m)`;
                        } else if (action === 'kick' && member.kickable) {
                            await member.kick("NG Word Threshold Exceeded");
                            actionTaken = "Kicked";
                        } else if (action === 'ban' && member.bannable) {
                            await member.ban({ reason: "NG Word Threshold Exceeded" });
                            actionTaken = "Banned";
                        }
                    };

                    if (count >= phase4Threshold) {
                        await applyAction(phase4Action);
                    } else if (count >= phase3Threshold) {
                        await applyAction(phase3Action);
                    } else if (count >= phase2Threshold) {
                        await applyAction(phase2Action);
                    }
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
                        .setFooter({ text: `状況: ${actionTaken} | 違反数: ${count}回` })
                        .setTimestamp();

                    await sendLog(message.guild, 'ng', embed);
                }
            }

            // 3. Automated Self-Introduction Gate (Pro+ Only)
            if (features.introGate) {
                // settings がまだ取得されていない場合はここで取得する
                if (!settings) {
                    const sr = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                    settings = sr.rows[0] || {};
                    cache.setSettings(message.guild.id, settings);
                }
                if (settings.self_intro_enabled && settings.intro_channel_id === message.channel.id) {
                    const minLength = settings.self_intro_min_length || 10;

                    if (message.content.length >= minLength) {
                        const roleId = settings.self_intro_role_id;
                        if (roleId) {
                            try {
                                const member = await message.guild.members.fetch(message.author.id);
                                if (!member.roles.cache.has(roleId)) {
                                    await member.roles.add(roleId, "Automated Self-Intro Gate");
                                    await message.react("✅").catch(() => { });
                                }
                            } catch (e) {
                                console.error("[INTRO-GATE ERROR] Failed to assign role:", e.message);
                            }
                        }
                    }
                }
            }

            // 4. Message Count Aura (message trigger rules)
            if (features.aura) {
                let auraSettings = cache.getSettings(message.guild.id);
                if (!auraSettings) {
                    const sr = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                    auraSettings = sr.rows[0] || {};
                    cache.setSettings(message.guild.id, auraSettings);
                }
                const msgRules = (auraSettings.vc_role_rules || []).filter(r => r.trigger === 'messages');
                if (msgRules.length > 0) {
                    const statsRes = await dbQuery(
                        "UPDATE member_stats SET message_count = COALESCE(message_count, 0) + 1 WHERE guild_id = $1 AND user_id = $2 RETURNING message_count",
                        [message.guild.id, message.author.id]
                    );
                    if (statsRes.rows.length > 0) {
                        const msgCount = statsRes.rows[0].message_count;
                        const guildMember = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
                        if (guildMember) {
                            for (const rule of msgRules) {
                                if (msgCount >= rule.messages && !guildMember.roles.cache.has(rule.role_id)) {
                                    await guildMember.roles.add(rule.role_id).catch(() => null);
                                    console.log(`[MSG-AURA] ${message.author.tag} received aura: ${rule.aura_name} (${msgCount} msgs)`);
                                }
                            }
                        }
                    }
                }
            }

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
