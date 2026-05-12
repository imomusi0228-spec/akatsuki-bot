import { dbQuery } from "../../core/db.js";
import { discordApi } from "../../middleware/auth.js";
import { client } from "../../core/client.js";
import { cache } from "../../core/cache.js";

export function hasManageGuild(permissions, owner = false) {
    if (owner === true) return true;
    const MANAGE_GUILD = 0x20n;
    const ADMINISTRATOR = 0x8n;
    const p = BigInt(permissions || "0");
    return (p & MANAGE_GUILD) === MANAGE_GUILD || (p & ADMINISTRATOR) === ADMINISTRATOR;
}

export const resJson = (res, data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
};

export const getBody = async (req) => {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                resolve({});
            }
        });
    });
};

export const getSafeGuild = async (gid) => {
    if (!gid) return null;
    return client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
};

export const verifyGuild = async (guildId, session) => {
    if (!guildId || !session) return false;

    try {
        const guild = await getSafeGuild(guildId);
        if (!guild) return false;

        const globalCache = cache.getUserGuilds(session.user.id);
        if (globalCache) {
            session.guilds = globalCache;
        } else if (!Array.isArray(session.guilds) || session.guilds.length === 0) {
            let attempt = 0;
            while (attempt < 7) {
                const userGuilds = await discordApi(session.accessToken, "/users/@me/guilds");
                if (Array.isArray(userGuilds)) {
                    session.guilds = userGuilds;
                    cache.setUserGuilds(session.user.id, userGuilds);
                    break;
                }
                if (userGuilds?.status === 429) {
                    const retryAfter = userGuilds.retry_after || 1;
                    await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 500));
                    attempt++;
                    continue;
                }
                return false;
            }
        }

        if (!Array.isArray(session.guilds)) return false;
        const targetGuild = session.guilds.find((g) => g.id === guildId);
        if (!targetGuild) return false;

        return hasManageGuild(targetGuild.permissions, targetGuild.owner);
    } catch (e) {
        console.error(`[AUTH ERROR] verifyGuild failed for ${guildId}:`, e.message);
        return false;
    }
};
