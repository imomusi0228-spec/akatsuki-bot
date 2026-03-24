import { PermissionFlagsBits } from "discord.js";
import { dbQuery } from "./db.js";
import { TIERS } from "./tiers.js";
import { cache } from "./cache.js";
import { ENV } from "../config/env.js";
import { getFeatures, TIER_NAMES, TIER_COLORS, normalizeTier } from "./tiers.js";
import { client } from "./client.js";

// Cache for ULTIMATE user IDs to avoid frequent DB lookups
let ultimateUsersCache = {
    ids: new Set(),
    lastFetch: 0
};

async function getUltimateUserIds() {
    const now = Date.now();
    if (now - ultimateUsersCache.lastFetch < 300000) { // 5 min cache
        return ultimateUsersCache.ids;
    }
    try {
        const res = await dbQuery("SELECT TRIM(user_id) as user_id FROM subscriptions WHERE (tier = $1 OR tier = 'ULTIMATE') AND (valid_until IS NULL OR valid_until > NOW())", [TIERS.ULTIMATE]);
        ultimateUsersCache.ids = new Set(res.rows.map(r => r.user_id));
        ultimateUsersCache.lastFetch = now;
        return ultimateUsersCache.ids;
    } catch (e) {
        console.error("[SUBSCRIPTION ERROR] Failed to fetch ULTIMATE users:", e.message);
        return ultimateUsersCache.ids;
    }
}

/**
 * Get current tier for a guild (Async)
 * Priority: Support Guild (ULTIMATE) > Database > Owner (Trial Pro+) > Trial Pro+ (M5) > Pro+ > Pro > Free
 */
export async function getTier(guildId) {
    if (!guildId) return TIERS.FREE;

    // 0. Cache Check
    const cachedTier = cache.getTier(guildId);
    if (cachedTier !== null) return cachedTier;

    // 1. Support Server Check (Special Case)
    if (ENV.SUPPORT_GUILD_ID && guildId === ENV.SUPPORT_GUILD_ID) return TIERS.ULTIMATE;

    // 2. Database Check (Active Subscription)
    const res = await dbQuery(
        "SELECT tier FROM subscriptions WHERE TRIM(guild_id) = TRIM($1) AND (valid_until IS NULL OR valid_until > NOW()) ORDER BY tier DESC LIMIT 1",
        [guildId]
    );

    let tier = normalizeTier(res.rows[0]?.tier);

    // 3. Portable ULTIMATE Check (Owner & Managers) - "Expert License"
    if (tier < TIERS.ULTIMATE) {
        // Check local Expert License cache
        const expertCached = cache.getExpertLicense(guildId);
        if (expertCached === true) {
            tier = TIERS.ULTIMATE;
        } else {
            const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
            if (guild) {
                // Check Owner
                const ownerTier = await getUserTier(guild.ownerId);
                if (ownerTier === TIERS.ULTIMATE) {
                    console.log(`[TIER DEBUG] Guild ${guildId} is ULTIMATE via Owner ${guild.ownerId}`);
                    tier = TIERS.ULTIMATE;
                    cache.setExpertLicense(guildId, true);
                } else {
                    // Check if any ULTIMATE user is an administrator
                    const ultimateIds = await getUltimateUserIds();
                    if (ultimateIds.size > 0) {
                        for (const uid of ultimateIds) {
                            try {
                                const cleanUid = String(uid).trim();
                                const member = guild.members.cache.get(cleanUid) || await guild.members.fetch(cleanUid).catch(() => null);
                                if (member && (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild))) {
                                    console.log(`[TIER DEBUG] Guild ${guildId} is ULTIMATE via Admin ${cleanUid}`);
                                    tier = TIERS.ULTIMATE;
                                    cache.setExpertLicense(guildId, true);
                                    break;
                                }
                            } catch (_) {}
                        }
                    }
                }
            }
            if (tier < TIERS.ULTIMATE) cache.setExpertLicense(guildId, false);
        }
    }

    // 4. Multi-Server Limit Logic (For non-ULTIMATE)
    if (tier !== TIERS.ULTIMATE && tier > TIERS.FREE) {
        const features = getFeatures(tier);
        const limit = features.maxGuilds || 1;

        const subRes = await dbQuery(
            "SELECT guild_id FROM subscriptions WHERE user_id = (SELECT user_id FROM subscriptions WHERE guild_id = $1 LIMIT 1) AND (valid_until IS NULL OR valid_until > NOW()) ORDER BY created_at ASC",
            [guildId]
        );
        const activeRows = subRes.rows;

        if (activeRows.findIndex((r) => r.guild_id === guildId) >= limit) {
            tier = TIERS.FREE; // Restricted due to limit
        }
    }

    cache.setTier(guildId, tier);
    return tier;
}

/**
 * Get highest tier associated with a user globally
 */
export async function getUserTier(userId) {
    const cleanUserId = String(userId).trim();
    
    // Cache Check
    const cached = cache.getUserTier(cleanUserId);
    if (cached !== null) return cached;

    console.log(`[TIER DEBUG] Fetching Tier for user: [${cleanUserId}]`);

    const res = await dbQuery(
        "SELECT tier, user_id, valid_until FROM subscriptions WHERE TRIM(user_id) = $1 AND (valid_until IS NULL OR valid_until > NOW()) ORDER BY tier DESC LIMIT 1",
        [cleanUserId]
    );

    let tier = TIERS.FREE;
    if (res.rows.length > 0) {
        const row = res.rows[0];
        console.log(`[TIER DEBUG] Subscription found for ${cleanUserId}: Tier=${row.tier}`);
        tier = normalizeTier(row.tier);
    } else {
        console.log(`[TIER DEBUG] No subscription found for ${cleanUserId}`);
    }

    cache.setUserTier(cleanUserId, tier);
    return tier;
}

/**
 * Get full subscription info including effective features (Expert License support)
 */
export async function getSubscriptionInfo(guildId, userId = null) {
    const res = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);
    const sub = res.rows[0];

    const guildTier = await getTier(guildId);
    const userTier = userId ? await getUserTier(userId) : TIERS.FREE;

    // Effective Tier (Highest of Guild or User)
    const effectiveTier = (userTier > guildTier) ? userTier : guildTier;
    const features = getFeatures(guildTier, guildId, userTier);

    return {
        tier: effectiveTier,
        guildTier: guildTier,
        userTier: userTier,
        name: TIER_NAMES[effectiveTier] || (effectiveTier === 999 ? "ULTIMATE" : "Free"),
        color: TIER_COLORS[effectiveTier] || "#8b9bb4",
        features: features,
        valid_until: sub?.valid_until || null,
        milestone: sub?.current_milestone ?? 5,
    };
}
