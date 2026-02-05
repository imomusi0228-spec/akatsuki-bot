import { dbQuery, pool } from "../core/db.js";
import { TIERS } from "../core/tiers.js";

const TARGET_GUILDS = [
    "1461286945530445834",
    "1467338822051430572"
];

const TIER_TO_SET = TIERS.PRO_PLUS_YEARLY; // 4
const VALID_DAYS = 365;

(async () => {
    try {
        console.log("🔌 Connecting to DB...");

        for (const guildId of TARGET_GUILDS) {
            console.log(`✨ Provisioning Pro+ for Guild: ${guildId}`);

            // Check if exists
            const check = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);

            const validUntil = new Date();
            validUntil.setDate(validUntil.getDate() + VALID_DAYS);

            if (check.rows.length === 0) {
                await dbQuery(
                    "INSERT INTO subscriptions (guild_id, tier, valid_until) VALUES ($1, $2, $3)",
                    [guildId, TIER_TO_SET, validUntil]
                );
                console.log("   ✅ Inserted new subscription.");
            } else {
                await dbQuery(
                    "UPDATE subscriptions SET tier = $1, valid_until = $2, updated_at = NOW() WHERE guild_id = $3",
                    [TIER_TO_SET, validUntil, guildId]
                );
                console.log("   ✅ Updated existing subscription.");
            }
        }

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        await pool.end();
        console.log("👋 Done.");
    }
})();
