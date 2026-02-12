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
                const spamCheck = checkSpam(message.guild.id, message.author.id, message.content);
                if (spamCheck.isSpam) {
                    console.log(`[DEBUG] Spam detected for ${message.author.tag} in guild ${message.guild.id} (count: ${spamCheck.count})`);

                    // Delete the spam message
                    await message.delete().catch((e) => { console.error("[DEBUG] Spam Delete Failed:", e.message); });

                    // Actions based on count
                    if (spamCheck.count >= 5) {
                        // Kick the user
                        const member = await message.guild.members.fetch(message.author.id);
                        if (member.kickable) {
                            await member.kick("Spam detection threshold reached (Similarity)").catch(e => console.error("[DEBUG] Kick failed:", e));

                            // Log Kick
                            if (features.ngLog) {
                                const embed = new EmbedBuilder()
                                    .setAuthor({ name: message.member?.displayName || message.author.tag, iconURL: message.author.displayAvatarURL() })
                                    .setColor(0xFF0000)
                                    .setTitle("🔨 Anti-Spam: User Kicked")
                                    .setDescription(`**対象ユーザー**: <@${message.author.id}>\n**理由**: 類似メッセージの連投（スパム）`)
                                    .setTimestamp();
                                await sendLog(message.guild, 'ng', embed);
                            }
                        }
                    } else if (spamCheck.count >= 3) {
                        // Warn via DM or Channel (already deleted the message)
                        try {
                            const warningMsg = `⚠️ **連投スパムを検知しました / Spam detected**\n\n` +
                                `サーバー: **${message.guild.name}**\n` +
                                `似たような内容を繰り返し送信しないでください。 / Please do not repeat similar messages.\n` +
                                `このまま続けるとサーバーから退出させられる可能性があります。 / Continued spamming will result in a kick.`;
                            await message.author.send(warningMsg);
                        } catch (e) { }
                    }

                    // If it's spam, we probably don't need to check for NG words again
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
                console.log(`[DEBUG] Caught NG words: ${caughtWords.join(", ")} in guild ${message.guild.id}`);
                // Delete message
                await message.delete().catch((e) => { console.error("[DEBUG] Delete Failed:", e.message); });

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
                console.log(`[DEBUG] Violation count for ${message.author.tag}: ${count}/${threshold}`);

                let actionTaken = "Msg Deleted";

                // Timeout Execution
                if (count >= threshold) {
                    console.log(`[DEBUG] Threshold reached. Attempting timeout...`);
                    try {
                        const member = await message.guild.members.fetch(message.author.id);
                        console.log(`[DEBUG] Member moderatable: ${member.moderatable}`);
                        if (member.moderatable) {
                            if (timeoutMin > 0) {
                                await member.timeout(timeoutMin * 60 * 1000, "NG Word Threshold Exceeded");
                                actionTaken = `Timeout (${timeoutMin}m)`;
                                console.log(`[DEBUG] Timeout Success!`);
                            } else {
                                console.log(`[DEBUG] Timeout minutes is 0, skipping.`);
                            }
                        } else {
                            console.log(`[DEBUG] Bot lacks permission to timeout this member.`);
                            actionTaken = "Msg Deleted (No Perm for Timeout)";
                        }
                    } catch (e) { console.error("[DEBUG] Timeout Failed:", e); }
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

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
