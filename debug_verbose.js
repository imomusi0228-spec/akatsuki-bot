import { pool } from "./core/db.js";
import { getTier } from "./core/subscription.js";
import { TIER_NAMES, TIERS } from "./core/tiers.js";

async function debug() {
    try {
        console.log("=== DEBUG START ===");
        console.log("TIER_NAMES:", JSON.stringify(TIER_NAMES, null, 2));
        console.log("TIERS:", JSON.stringify(TIERS, null, 2));

        const res = await pool.query("SELECT * FROM subscriptions");
        for (const row of res.rows) {
            console.log("\n--------------------------------------------------");
            console.log(`Guild ID: ${row.guild_id}`);
            console.log(`Raw DB Row:`, JSON.stringify(row));
            console.log(`row.tier Type: ${typeof row.tier}`);
            console.log(`row.tier Value: ${row.tier}`);

            const tier = await getTier(row.guild_id);
            console.log(`getTier() Result: ${tier} (Type: ${typeof tier})`);

            const name = TIER_NAMES[tier];
            console.log(`TIER_NAMES lookup: ${name}`);

            if (name === undefined) {
                console.log("!!! NAME IS UNDEFINED !!!");
                console.log(`Is tier a valid key? Keys: ${Object.keys(TIER_NAMES).join(',')}`);
            }
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
debug();
