import { dbQuery, pool } from "../core/db.js";
import { TIERS } from "../core/tiers.js";

// Usage: node scripts/give_trial.js <GUILD_ID> <USER_ID> [TYPE]
const args = process.argv.slice(2);
const guildId = args[0];
const userId = args[1];
const type = args[2]; // "pro" or "plus" (default)

if (!guildId || !userId) {
    console.error("Usage: node scripts/give_trial.js <GUILD_ID> <USER_ID> [TYPE]");
    process.exit(1);
}

const tier = type === "pro" ? TIERS.TRIAL_PRO : TIERS.TRIAL_PRO_PLUS;
const tierName = type === "pro" ? "Trial Pro" : "Trial Pro+";

(async () => {
    try {
        console.log(`🔌 Connecting to DB...`);
        console.log(`✨ Giving ${tierName} to Guild: ${guildId} (User: ${userId})`);

        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30); // 30 Days Trial

        // Upsert
        const check = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);
        if (check.rows.length === 0) {
            await dbQuery(
                "INSERT INTO subscriptions (guild_id, tier, user_id, valid_until) VALUES ($1, $2, $3, $4)",
                [guildId, tier, userId, validUntil]
            );
            console.log(`   ✅ Inserted new ${tierName} subscription.`);
        } else {
            await dbQuery(
                "UPDATE subscriptions SET tier = $1, user_id = $2, valid_until = $3, updated_at = NOW() WHERE guild_id = $4",
                [tier, userId, validUntil, guildId]
            );
            console.log(`   ✅ Updated to ${tierName} subscription.`);
        }

    } catch (e) {
        console.error("❌ Error:", e);
    } finally {
        await pool.end();
    }
})();
