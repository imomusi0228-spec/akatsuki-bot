import { Events, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { sendLog } from "../core/logger.js";
import { checkSpam } from "../core/protection.js";
import { cache } from "../core/cache.js";

export default {
    name: Events.MessageCreate,
    async default(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        try {
            // Spam Protection (Similarity-based)
            const tier = await getTier(message.guild.id);
            const features = getFeatures(tier);

            if (features.spamProtection) {
                // 1. Content Similarity Spam
                const spamCheck = checkSpam(message.guild.id, message.author.id, message.content);

                // 2. Mention Spam
                const mentionCount = message.mentions.users.size + message.mentions.roles.size;
                const mentionCheck = checkMentionSpam(message.guild.id, message.author.id, mentionCount);

                // 3. Rate Limit (Frequency)
                const { checkRateLimit } = await import("../core/protection.js");
                const rateCheck = checkRateLimit(message.guild.id, message.author.id);

                if (spamCheck.isSpam || mentionCheck.isSpam || rateCheck.isSpam) {
                    const isMentionSpam = mentionCheck.isSpam;
                    const isRateSpam = rateCheck.isSpam && !spamCheck.isSpam && !mentionCheck.isSpam;
                    const count = isMentionSpam ? mentionCheck.count : (isRateSpam ? rateCheck.count : spamCheck.count);


                    // Delete the spam message
                    await message.delete().catch((e) => { console.error("[DEBUG] Spam Delete Failed:", e.message); });

                    // Actions based on count
                    if (count >= 5 || (isMentionSpam && count >= 8)) {
                        // Kick the user
                        const member = await message.guild.members.fetch(message.author.id);
                        if (member.kickable) {
                            let reason = "Content Spam detector";
                            if (isMentionSpam) reason = "Mention Spam detector";
                            if (isRateSpam) reason = "Rate Limit detector (High frequency)";

                            await member.kick(reason).catch(e => console.error("[DEBUG] Kick failed:", e));

                            // Log Kick to member_events
                            await dbQuery("INSERT INTO member_events (guild_id, user_id, event_type) VALUES ($1, $2, 'kick')",
                                [message.guild.id, message.author.id]);

                            // Log Kick to UI Channel
                            if (features.ngLog) {
                                let typeLabel = 'Content';
                                if (isMentionSpam) typeLabel = 'Mentions';
                                if (isRateSpam) typeLabel = 'Frequency';

                                const embed = new EmbedBuilder()
                                    .setAuthor({ name: message.member?.displayName || message.author.tag, iconURL: message.author.displayAvatarURL() })
                                    .setColor(0xFF0000)
                                    .setTitle(`🔨 Anti-Spam: User Kicked (${typeLabel})`)
                                    .setDescription(`**対象ユーザー**: <@${message.author.id}>\n**理由**: ${isMentionSpam ? 'メンションの大量送信' : (isRateSpam ? 'メッセージの過度な連投' : '類似メッセージの連投')}`)
                                    .setTimestamp();
                                await sendLog(message.guild, 'ng', embed);
                            }
                        }
                    } else if (count >= 3) {
                        // Warn
                        try {
                            const warningMsg = `⚠️ **スパムを検知しました / Spam detected**\n\n` +
                                `サーバー: **${message.guild.name}**\n` +
                                `${isMentionSpam ? 'メンションを一度に大量に送信しないでください。' : (isRateSpam ? 'メッセージを短時間に連続して送信しないでください。' : '似たような内容を繰り返し送信しないでください。')}\n` +
                                `このまま続けるとサーバーから退出させられる可能性があります。`;
                            await message.author.send(warningMsg);
                        } catch (e) { }
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
                    try {
                        const match = ng.word.match(/^\/(.*?)\/([gimsuy]*)$/);
                        const regex = match ? new RegExp(match[1], match[2]) : new RegExp(ng.word);
                        if (regex.test(message.content)) caughtWords.push(ng.word);
                    } catch (e) {
                        console.error("Invalid Regex in DB:", ng.word);
                    }
                } else {
                    if (message.content.includes(ng.word)) caughtWords.push(ng.word);
                }
                // Do NOT break, keep checking other words to count multiple violations
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

                // Log EACH word to DB
                for (const word of caughtWords) {
                    await dbQuery("INSERT INTO ng_logs (guild_id, user_id, user_name, word) VALUES ($1, $2, $3, $4)",
                        [message.guild.id, message.author.id, message.author.tag, word]);
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

                                // Log Timeout to member_events
                                await dbQuery("INSERT INTO member_events (guild_id, user_id, event_type) VALUES ($1, $2, 'timeout')",
                                    [message.guild.id, message.author.id]);

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
