import { pool } from "./core/db.js";
import { getTier } from "./core/subscription.js";
import { TIER_NAMES } from "./core/tiers.js";

async function debug() {
    try {
        const res = await pool.query("SELECT * FROM subscriptions");
        let foundIssue = false;

        for (const row of res.rows) {
            const tier = await getTier(row.guild_id);
            const name = TIER_NAMES[tier];

            if (name === undefined) {
                foundIssue = true;
                console.log("!!! ISSUE FOUND !!!");
                console.log(`Guild ID: ${row.guild_id}`);
                console.log(`DB Row Tier:`, row.tier);
                console.log(`getTier() Result:`, tier);
                console.log(`Type of Result:`, typeof tier);
            }
        }

        if (!foundIssue) console.log("No issues found. All tiers map correctly.");

    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
debug();
