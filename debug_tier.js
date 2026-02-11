import { getTier } from "./core/subscription.js";
import { TIERS, TIER_NAMES } from "./core/tiers.js";
import { pool } from "./core/db.js";

async function simulate() {
    try {
        console.log("TIERS:", TIERS);
        console.log("TIER_NAMES:", TIER_NAMES);

        const res = await pool.query("SELECT guild_id, tier FROM subscriptions LIMIT 5");
        console.log("\nSample Subscriptions:", res.rows);

        for (const row of res.rows) {
            const tier = await getTier(row.guild_id);
            console.log(`Guild ${row.guild_id}: Tier=${tier} (Type: ${typeof tier}) -> Name='${TIER_NAMES[tier]}'`);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

simulate();
