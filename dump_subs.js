import { pool } from "./core/db.js";
import { getTier } from "./core/subscription.js";
import { TIER_NAMES } from "./core/tiers.js";

async function dump() {
    try {
        const res = await pool.query("SELECT * FROM subscriptions");
        console.log("Count:", res.rowCount);
        for (const row of res.rows) {
            const calculated = await getTier(row.guild_id);
            console.log(`Guild: ${row.guild_id}, DB Tier: ${row.tier} (${typeof row.tier}), Calc Tier: ${calculated}, Name: ${TIER_NAMES[calculated]}`);
        }
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
dump();
