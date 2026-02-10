import { Events, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";

export default {
    name: Events.MessageCreate,
    async default(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        try {
            // Load NG words
            const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [message.guild.id]);
            const ngWords = res.rows;

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
                const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                const settings = settingsRes.rows[0] || {};
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
                    await message.author.send(`⚠️ **Warning from ${message.guild.name}**\nYour message was removed because it contained prohibited word(s): ||${joinedWords}||`);
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

                if (features.logs && settings.log_channel_id) {
                    try {
                        const channel = await message.guild.channels.fetch(settings.log_channel_id);
                        if (channel) {
                            const embed = new EmbedBuilder()
                                .setAuthor({ name: message.member?.displayName || message.author.tag, iconURL: message.author.displayAvatarURL() })
                                .setColor(0xFF0000)
                                .setTitle("🚨 NG Word Detected")
                                .setDescription(`**NGワード**: ||${joinedWords}||\n**本文**: ||${message.content}||`)
                                .setFooter({ text: `状況: ${actionTaken} (${count}/${threshold})` })
                                .setTimestamp();

                            channel.send({ embeds: [embed] });
                        }
                    } catch (e) { }
                }
            }

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
