import { dbQuery } from "./db.js";
import { TIERS, FEATURES } from "./tiers.js";
import { ENV } from "../config/env.js";
import { cache } from "./cache.js";

/**
 * Get the subscription tier for a guild
 * Support server always gets PRO_PLUS
 */
export async function getTier(guildId) {
    const cached = cache.getTier(guildId); // cache.getTier currently returns just number or null
    if (cached !== null) return cached;

    let tier = TIERS.FREE;

    // 2. Check if this is the support server
    if (ENV.SUPPORT_SERVER_ID && guildId === ENV.SUPPORT_SERVER_ID) {
        tier = TIERS.PRO_PLUS_YEARLY;
        cache.setTier(guildId, tier);
        return tier;
    }

    // 3. Fetch subscription for this guild from DB
    const res = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);
    const sub = res.rows[0];

    if (!sub) {
        tier = TIERS.FREE;
        cache.setTier(guildId, tier);
        return tier;
    }

    tier = parseInt(sub.tier, 10) || TIERS.FREE;

    // Normalize tier to number
    sub.tier = parseInt(sub.tier, 10);

    // If it's a PRO_PLUS or TRIAL_PRO_PLUS tier, verify the server limit for the owner
    // We check if this guild is within the allowed limit for this user.
    if (sub.tier >= TIERS.PRO_PLUS_MONTHLY && sub.user_id) {
        // Optimization: For Pro+, the limit check is expensive. 
        // We assume the user's guild list doesn't change every second.
        // The cache.getTier(guildId) already returns the tier, but here we decide if it's FREE or PRO_PLUS.

        const features = FEATURES[sub.tier];
        const limit = features.maxGuilds || 1;

        // Get all guilds for this user with the same or higher tier
        const listRes = await dbQuery(
            "SELECT guild_id FROM subscriptions WHERE user_id = $1 AND tier >= $2 ORDER BY updated_at ASC",
            [sub.user_id, sub.tier]
        );

        const activeIds = listRes.rows.map(r => r.guild_id);
        const allowedIds = activeIds.slice(0, limit);

        if (!allowedIds.includes(guildId)) {
            tier = TIERS.FREE; // Restricted due to limit
        }
    }

    cache.setTier(guildId, tier); // Cache the FINAL decided tier (including limit restriction)
    return tier;
}

/**
 * Get full subscription info including milestone
 */
export async function getSubscriptionInfo(guildId) {
    const res = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);
    const sub = res.rows[0];

    if (!sub) {
        return { tier: TIERS.FREE, milestone: 5 }; // Default to max milestone for legacy/free if no record
    }

    const tier = await getTier(guildId); // Re-run logic for limits/cache
    return {
        tier: tier,
        milestone: sub.current_milestone ?? 5,
        auto_unlock: sub.auto_unlock_enabled ?? false,
        trial_started_at: sub.trial_started_at
    };
}
