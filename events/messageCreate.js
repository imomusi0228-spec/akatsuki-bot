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

            let caughtWord = null;
            for (const ng of ngWords) {
                if (ng.kind === "regex") {
                    try {
                        const match = ng.word.match(/^\/(.*?)\/([gimsuy]*)$/);
                        const regex = match ? new RegExp(match[1], match[2]) : new RegExp(ng.word);
                        if (regex.test(message.content)) caughtWord = ng.word;
                    } catch (e) {
                        console.error("Invalid Regex in DB:", ng.word);
                    }
                } else {
                    if (message.content.includes(ng.word)) caughtWord = ng.word;
                }
                if (caughtWord) break;
            }

            if (caughtWord) {
                // Delete message
                await message.delete().catch(() => { });

                // Fetch Settings
                const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [message.guild.id]);
                const settings = settingsRes.rows[0] || {};
                const threshold = settings.ng_threshold || 3;
                const timeoutMin = settings.timeout_minutes || 10;

                // Log to DB
                await dbQuery("INSERT INTO ng_logs (guild_id, user_id, user_name, word) VALUES ($1, $2, $3, $4)",
                    [message.guild.id, message.author.id, message.author.tag, caughtWord]);

                // DM Warning
                try {
                    await message.author.send(`⚠️ **Warning from ${message.guild.name}**\nYour message was removed because it contained a prohibited word: ||${caughtWord}||`);
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
                            await member.timeout(timeoutMin * 60 * 1000, "NG Word Threshold Exceeded");
                            actionTaken = `Timeout (${timeoutMin}m)`;
                        }
                    } catch (e) { console.error("Timeout Failed:", e); }
                }

                // Log to Channel
                const tier = await getTier(message.guild.id);
                const features = getFeatures(tier);

                if (features.logs && settings.log_channel_id) {
                    try {
                        const channel = await message.guild.channels.fetch(settings.log_channel_id);
                        if (channel) {
                            channel.send(`🚨 **NG Word Detected**\nUser: <@${message.author.id}>\nWord: ||${caughtWord}||\nCount: ${count}/${threshold}\nAction: ${actionTaken}\nChannel: <#${message.channel.id}>`);
                        }
                    } catch (e) { }
                }
            }

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
