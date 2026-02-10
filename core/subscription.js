import { dbQuery } from "./db.js";
import { TIERS } from "./tiers.js";
import { ENV } from "../config/env.js";

/**
 * Get the subscription tier for a guild
 * Support server always gets PRO_PLUS
 */
export async function getTier(guildId) {
    // Check if this is the support server
    if (ENV.SUPPORT_SERVER_ID && guildId === ENV.SUPPORT_SERVER_ID) {
        return TIERS.PRO_PLUS_YEARLY;
    }

    // Fetch subscription for this guild
    const res = await dbQuery("SELECT * FROM subscriptions WHERE guild_id = $1", [guildId]);
    const sub = res.rows[0];
    if (!sub) return TIERS.FREE;

    // If it's a PRO_PLUS tier, verify the 3-server limit for the owner
    if (sub.tier >= TIERS.PRO_PLUS_MONTHLY && sub.user_id) {
        const countRes = await dbQuery(
            "SELECT COUNT(*) as cnt FROM subscriptions WHERE user_id = $1 AND tier >= $2",
            [sub.user_id, TIERS.PRO_PLUS_MONTHLY]
        );
        const proPlusCount = parseInt(countRes.rows[0].cnt);

        // If they exceed 3, but this guild is NOT one of the primary 3 (ordered by updated_at or id)
        // For simplicity: If count > 3, we downgrade others to FREE or just allow the first 3.
        // Here we'll check if this guild is within the first 3 for this user.
        const listRes = await dbQuery(
            "SELECT guild_id FROM subscriptions WHERE user_id = $1 AND tier >= $2 ORDER BY updated_at ASC LIMIT 3",
            [sub.user_id, TIERS.PRO_PLUS_MONTHLY]
        );
        const activeIds = listRes.rows.map(r => r.guild_id);
        if (!activeIds.includes(guildId)) {
            return TIERS.FREE; // Restricted due to limit
        }
    }

    return sub.tier;
}
