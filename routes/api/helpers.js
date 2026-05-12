import { dbQuery } from "../../core/db.js";
import { discordApi } from "../../middleware/auth.js";
import { client } from "../../core/client.js";
import { cache } from "../../core/cache.js";

export const PERMISSION_LEVELS = {
    NONE: 0,
    VIEWER: 1, // Optional future use
    MODERATOR: 2,
    ADMIN: 3
};

export function getPermissionLevel(permissions, owner = false) {
    if (owner === true) return PERMISSION_LEVELS.ADMIN;
    
    const p = BigInt(permissions || "0");
    const ADMINISTRATOR = 0x8n;
    const MANAGE_GUILD = 0x20n;
    const MANAGE_MESSAGES = 0x2000n;
    const KICK_MEMBERS = 0x2n;
    const BAN_MEMBERS = 0x4n;
    const MANAGE_CHANNELS = 0x10n;

    // Admin level
    if ((p & ADMINISTRATOR) === ADMINISTRATOR || (p & MANAGE_GUILD) === MANAGE_GUILD) {
        return PERMISSION_LEVELS.ADMIN;
    }

    // Moderator level
    if ((p & MANAGE_MESSAGES) === MANAGE_MESSAGES || 
        (p & KICK_MEMBERS) === KICK_MEMBERS || 
        (p & BAN_MEMBERS) === BAN_MEMBERS ||
        (p & MANAGE_CHANNELS) === MANAGE_CHANNELS) {
        return PERMISSION_LEVELS.MODERATOR;
    }

    return PERMISSION_LEVELS.NONE;
}

export function hasManageGuild(permissions, owner = false) {
    return getPermissionLevel(permissions, owner) === PERMISSION_LEVELS.ADMIN;
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

export const verifyGuild = async (guildId, session, minLevel = PERMISSION_LEVELS.MODERATOR) => {
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

        const level = getPermissionLevel(targetGuild.permissions, targetGuild.owner);
        if (level < minLevel) return false;

        return { guild, level };
    } catch (e) {
        console.error(`[AUTH ERROR] verifyGuild failed for ${guildId}:`, e.message);
        return false;
    }
};
