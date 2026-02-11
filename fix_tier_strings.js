import { pool } from "./core/db.js";
import { TIERS } from "./core/tiers.js";

async function fix() {
    try {
        console.log("Fixing legacy string values...");

        // Fix "Pro+" -> 3 (PRO_PLUS_MONTHLY)
        await pool.query("UPDATE subscriptions SET tier = $1 WHERE tier::text = 'Pro+'", [TIERS.PRO_PLUS_MONTHLY]);
        console.log("Fixed 'Pro+'");

        // Fix "Pro" -> 1 (PRO_MONTHLY)
        await pool.query("UPDATE subscriptions SET tier = $1 WHERE tier::text = 'Pro'", [TIERS.PRO_MONTHLY]);
        console.log("Fixed 'Pro'");

        // Fix "Free" -> 0
        await pool.query("UPDATE subscriptions SET tier = $1 WHERE tier::text = 'Free'", [TIERS.FREE]);
        console.log("Fixed 'Free'");

        // Force convert column to INTEGER if it isn't already
        // This might fail if there are other garbage values, so we do it safely
        try {
            await pool.query("ALTER TABLE subscriptions ALTER COLUMN tier TYPE INTEGER USING tier::integer");
            console.log("Successfully altered column type to INTEGER");
        } catch (e) {
            console.error("Could not alter column type (yet):", e.message);
        }

        console.log("Done.");
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
fix();
