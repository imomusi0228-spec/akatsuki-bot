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

    // Otherwise, fetch from database
    const res = await dbQuery("SELECT tier FROM subscriptions WHERE guild_id = $1", [guildId]);
    return res.rows[0]?.tier || TIERS.FREE;
}
