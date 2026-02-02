// service/license.js
import "dotenv/config";

// Override Map for Debug
const tierOverrides = new Map();

export function setTierOverride(guildId, tier) {
    if (tier === null) {
        tierOverrides.delete(guildId);
    } else {
        tierOverrides.set(guildId, tier);
    }
}

export async function getLicenseTier(guildId, db) {
    if (!guildId) return "free";

    // 0. Check Override
    if (tierOverrides.has(guildId)) return tierOverrides.get(guildId);

    // 1. Check Whitelist (Env) -> Pro+ (Unlimited)
    const proPlus = (process.env.PRO_PLUS_GUILD_IDS || "").split(",").map(s => s.trim());
    if (proPlus.includes(guildId)) return "pro_plus";

    // 1b. Check Whitelist (Env) -> Free (Explicitly allowed)
    const freeIds = (process.env.FREE_GUILD_IDS || "").split(",").map(s => s.trim());
    if (freeIds.includes(guildId)) return "free";

    // 2. Check DB
    if (!db) return "free";
    const row = await db.get("SELECT expires_at, tier FROM licenses WHERE guild_id=$1", guildId);

    if (!row) return "free";

    // Check Expiration
    if (row.expires_at) {
        if (Date.now() > Number(row.expires_at)) return "free"; // Expired -> Fallback to Free
    }

    // Return stored tier (or free if invalid)
    return row.tier || "free";
}

// Redefine getLicenseTier to return "none" if not found
export async function getLicenseTierStrict(guildId, db) {
    if (!guildId) return "none";

    // 0. Check Override
    if (tierOverrides.has(guildId)) return tierOverrides.get(guildId);

    const proPlus = (process.env.PRO_PLUS_GUILD_IDS || "").split(",").map(s => s.trim());
    if (proPlus.includes(guildId)) return "pro_plus";

    const freeIds = (process.env.FREE_GUILD_IDS || "").split(",").map(s => s.trim());
    if (freeIds.includes(guildId)) return "free";

    // DBがない場合は Free として扱う（DBレス運用対応）
    if (!db) return "free";
    const row = await db.get("SELECT expires_at, tier FROM licenses WHERE guild_id=$1", guildId);
    if (!row) return "free"; // DBにあってレコードがない場合も Free

    if (row.expires_at && Date.now() > Number(row.expires_at)) return "free"; // Expired -> Free

    return row.tier || "free";
}
