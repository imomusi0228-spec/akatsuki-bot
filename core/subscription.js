import { dbQuery } from "./db.js";
import { TIERS, FEATURES } from "./tiers.js";
import { ENV } from "../config/env.js";
import { cache } from "./cache.js";
import { client } from "./client.js";
import { PermissionFlagsBits } from "discord.js";

/**
 * Get the subscription tier for a guild
 * Support server always gets PRO_PLUS
 */
export async function getTier(guildId) {
    const cached = cache.getTier(guildId); // cache.getTier currently returns just number or null
    if (cached !== null) return cached;

    let tier = TIERS.FREE;

    // 2. Check if this is the support server
    if (ENV.SUPPORT_GUILD_ID && guildId === ENV.SUPPORT_GUILD_ID) {
        tier = TIERS.ULTIMATE;
        cache.setTier(guildId, tier);
        return tier;
    }

    // 2.5 Check if the Special User is an Admin in this guild
    if (ENV.SPECIAL_USER_ID) {
        try {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                const member = await guild.members.fetch(ENV.SPECIAL_USER_ID).catch(() => null);
                if (member && member.permissions.has(PermissionFlagsBits.Administrator)) {
                    tier = TIERS.ULTIMATE;
                    cache.setTier(guildId, tier);
                    return tier;
                }
            }
        } catch (e) { }
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

    // Check if subscription has expired
    if (sub.valid_until && new Date(sub.valid_until) < new Date()) {
        tier = TIERS.FREE;
        cache.setTier(guildId, tier);
        return tier;
    }

    // Normalize tier to number
    sub.tier = parseInt(sub.tier, 10);

    // If it's a PRO_PLUS or TRIAL_PRO_PLUS tier, verify the server limit for the owner
    // We check if this guild is within the allowed limit for this user.
    if (sub.tier >= TIERS.PRO_PLUS_MONTHLY && sub.user_id) {
        const features = FEATURES[sub.tier];
        const limit = features.maxGuilds || 1;

        // Get all guilds for this user
        const listRes = await dbQuery(
            "SELECT guild_id, tier FROM subscriptions WHERE user_id = $1 ORDER BY updated_at DESC",
            [sub.user_id]
        );

        // Filter and sort to prioritize current guild
        let activeRows = listRes.rows.filter(r => {
            let t = parseInt(r.tier, 10);
            if (isNaN(t)) {
                if (r.tier === "Trial Pro+") t = TIERS.TRIAL_PRO_PLUS;
                else if (r.tier === "Trial Pro") t = TIERS.TRIAL_PRO;
                else return false;
            }
            return t >= sub.tier;
        });

        // Ensure current guild is at the top to be counted in limit
        const currentIdx = activeRows.findIndex(r => r.guild_id === guildId);
        if (currentIdx > 0) {
            const [current] = activeRows.splice(currentIdx, 1);
            activeRows.unshift(current);
        }

        const allowedIds = activeRows.slice(0, limit).map(r => r.guild_id);

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
