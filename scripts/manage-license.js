import { dbQuery, pool } from "../core/db.js";
import { TIERS, TIER_NAMES } from "../core/tiers.js";

// Usage: node scripts/manage-license.js <GUILD_ID> <TIER_ID_OR_NAME> <DAYS> [USER_ID]
const args = process.argv.slice(2);
const [guildId, tierInput, daysInput, userId] = args;

if (!guildId || !tierInput || !daysInput) {
    console.log("Usage: node scripts/manage-license.js <GUILD_ID> <TIER_ID_OR_NAME> <DAYS> [USER_ID]");
    console.log("Tiers:");
    Object.entries(TIERS).forEach(([name, id]) => console.log(`  ${id}: ${name}`));
    process.exit(1);
}

const days = parseInt(daysInput);
let tier = parseInt(tierInput);

// Allow tier name lookup
if (isNaN(tier)) {
    const upperName = tierInput.toUpperCase();
    tier = TIERS[upperName];
    if (tier === undefined) {
        console.error(`❌ Invalid tier name: ${tierInput}`);
        process.exit(1);
    }
}

const tierDisplayName = TIER_NAMES[tier] || `Tier ${tier}`;

(async () => {
    try {
        console.log(`🔌 Connecting to DB...`);
        console.log(`✨ Provisioning ${tierDisplayName} for Guild: ${guildId}`);

        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + days);

        const check = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);

        if (check.rows.length === 0) {
            await dbQuery(
                "INSERT INTO subscriptions (guild_id, tier, user_id, valid_until) VALUES ($1, $2, $3, $4)",
                [guildId, tier, userId || null, validUntil]
            );
            console.log(`   ✅ Created new subscription valid until ${validUntil.toISOString().split('T')[0]}`);
        } else {
            await dbQuery(
                "UPDATE subscriptions SET tier = $1, user_id = COALESCE($2, user_id), valid_until = $3, updated_at = NOW() WHERE guild_id = $4",
                [tier, userId || null, validUntil, guildId]
            );
            console.log(`   ✅ Updated existing subscription valid until ${validUntil.toISOString().split('T')[0]}`);
        }

    } catch (e) {
        console.error("❌ Error:", e.message);
    } finally {
        await pool.end();
        console.log("👋 Done.");
        process.exit(0);
    }
})();
