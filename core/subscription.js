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

    // Return extended info if needed? Or just let it be.
    // For now, getTier always returns tier number to avoid breaking changes.
    // We will use a separate getSubscriptionInfo for the dashboard.

    tier = parseInt(sub.tier, 10) || TIERS.FREE;

    // Normalize tier to number
    sub.tier = parseInt(sub.tier, 10);

    // If it's a PRO_PLUS or TRIAL_PRO_PLUS tier, verify the server limit for the owner
    // We check if this guild is within the allowed limit for this user.
    if (sub.tier >= TIERS.PRO_PLUS_MONTHLY && sub.user_id) {
        const features = FEATURES[sub.tier];
        const limit = features.maxGuilds || 1;

        // Get all guilds for this user with the same or higher tier, ordered by updated_at (or id)
        // We use updated_at ASC to prioritize older subscriptions (first come, first served)
        const listRes = await dbQuery(
            "SELECT guild_id FROM subscriptions WHERE user_id = $1 AND tier >= $2 ORDER BY updated_at ASC",
            [sub.user_id, sub.tier] // Note: We filter by current tier or higher. If mixed tiers, this might need adjustment, but for now assuming uniform tier usage or strictly hierarchical.
        );

        // Actually, we should probably count checks per tier group. 
        // But to keep it simple and consistent: 
        // If I have 1 Pro+ (Limit 3) and 1 Trial (Limit 1), they are different tiers.
        // The query above filters `tier >= sub.tier`. 
        // If I am checking a Trial (5) guild: checks tier >= 5 (Trial only). Limit = 1.
        // If I am checking a Pro+ (3) guild: checks tier >= 3 (Pro+ and Trial). Limit = 3. 
        // This seems safe for expanding.

        const activeIds = listRes.rows.map(r => r.guild_id);

        const allowedIds = activeIds.slice(0, limit);

        if (!allowedIds.includes(guildId)) {
            return TIERS.FREE; // Restricted due to limit
        }
    }

    const finalTier = tier;
    cache.setTier(guildId, finalTier);
    return finalTier;
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
        milestone: sub.current_milestone ?? 1,
        auto_unlock: sub.auto_unlock_enabled ?? false,
        trial_started_at: sub.trial_started_at
    };
}
