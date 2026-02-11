import { pool } from "./core/db.js";

async function fixValues() {
    try {
        // Enforce integer type and default to 0
        await pool.query("UPDATE subscriptions SET tier = 0 WHERE tier IS NULL");

        // If there are any other weird values, let's reset them to 0 (Free)
        // e.g. undefined string, etc.
        // Postgres INTEGER column shouldn't hold 'undefined' string, 
        // but maybe the previous migration didn't convert correctly?

        const res = await pool.query("SELECT guild_id, tier FROM subscriptions");
        for (const row of res.rows) {
            if (row.tier === null || typeof row.tier === 'undefined') {
                console.log(`Fixing for ${row.guild_id}...`);
                await pool.query("UPDATE subscriptions SET tier = 0 WHERE guild_id = $1", [row.guild_id]);
            }
        }
        console.log("Values corrected.");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
fixValues();
