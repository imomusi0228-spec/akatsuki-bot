import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";

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



        } catch (e) {
            console.error("Message Event Error:", e);
        }
    },
};
