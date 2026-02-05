import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

const TIMEOUT_DURATION_MS = ENV.DEFAULT_TIMEOUT_MIN * 60 * 1000;

export default {
    name: Events.MessageCreate,
    async default(message) {
        if (message.author.bot) return;
        if (!message.guild) return;

        try {
            // Load NG words
            // Optimization: In a real bot, cache these. For now, DB query per message is simple but acceptable for small scale.
            const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [message.guild.id]);
            const ngWords = res.rows;

            if (ngWords.length === 0) return;

            let caught = false;
            for (const ng of ngWords) {
                if (ng.kind === "regex") {
                    try {
                        // Regex format: /pattern/flags
                        const match = ng.word.match(/^\/(.*?)\/([gimsuy]*)$/);
                        const regex = match ? new RegExp(match[1], match[2]) : new RegExp(ng.word);
                        if (regex.test(message.content)) caught = true;
                    } catch (e) {
                        console.error("Invalid Regex in DB:", ng.word);
                    }
                } else {
                    if (message.content.includes(ng.word)) caught = true;
                }
                if (caught) break;
            }

            if (caught) {
                // Delete message
                await message.delete().catch(() => { });

                // Log to channel
                const settingsRes = await dbQuery("SELECT log_channel_id FROM settings WHERE guild_id = $1", [message.guild.id]);
                const logChannelId = settingsRes.rows[0]?.log_channel_id;

                if (logChannelId) {
                    const channel = message.guild.channels.cache.get(logChannelId);
                    if (channel) {
                        channel.send(`🚨 **NG Word Detected**\nUser: ${message.author.tag}\nContent: ||${message.content}||\nChannel: <#${message.channel.id}>`);
                    }
                }
            }

        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
