import { resJson, verifyGuild, getSafeGuild } from "./helpers.js";
import { discordApi } from "../../middleware/auth.js";
import { cache } from "../../core/cache.js";
import { client } from "../../core/client.js";
import { getSubscriptionInfo } from "../../core/subscription.js";

export async function handleGuildRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const method = req.method;

    const isGuildRoute = pathname === "/api/guilds" || pathname === "/api/channels" || pathname === "/api/roles" || pathname === "/api/roles/members";
    if (!isGuildRoute) return false;

    // GET /api/guilds
    if (pathname === "/api/guilds" && method === "GET") {
        try {
            const refresh = url.searchParams.get("refresh") === "true";
            let userGuilds = !refresh ? (cache.getUserGuilds(session.user.id) || session.guilds) : null;

            if (!userGuilds || userGuilds.length === 0) {
                userGuilds = await discordApi(session.accessToken, "/users/@me/guilds");
                if (Array.isArray(userGuilds)) {
                    cache.setUserGuilds(session.user.id, userGuilds);
                    session.guilds = userGuilds;
                }
            }

            if (!Array.isArray(userGuilds)) return resJson(res, { ok: false, error: "Failed to fetch guilds" }, 500);

            const managedGuilds = userGuilds.filter(g => {
                const p = BigInt(g.permissions || "0");
                return (p & 0x20n) === 0x20n || (p & 0x8n) === 0x8n || g.owner;
            });

            const availableGuilds = managedGuilds.filter(g => client.guilds.cache.has(g.id)).map(g => ({ id: g.id, name: g.name, icon: g.icon }));
            const subInfo = await getSubscriptionInfo(availableGuilds[0]?.id, session.user.id);

            return resJson(res, { ok: true, guilds: availableGuilds, planName: subInfo.name, planColor: subInfo.color });
        } catch (e) {
            console.error("[GUILDS ERROR]", e);
            return resJson(res, { ok: false, error: "Internal Error" }, 500);
        }
    }

    if (!guildId) return resJson(res, { ok: false, error: "Missing guild" }, 400);
    if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);

    // GET /api/channels
    if (pathname === "/api/channels" && method === "GET") {
        const guild = await getSafeGuild(guildId);
        const channels = guild?.channels.cache.map(c => ({ id: c.id, name: c.name, type: c.type })) || [];
        return resJson(res, { ok: true, channels });
    }

    // GET /api/roles
    if (pathname === "/api/roles" && method === "GET") {
        const guild = await getSafeGuild(guildId);
        const roles = guild?.roles.cache.filter(r => r.name !== "@everyone" && !r.managed).map(r => ({ id: r.id, name: r.name })) || [];
        return resJson(res, { ok: true, roles });
    }

    // GET /api/roles/members
    if (pathname === "/api/roles/members" && method === "GET") {
        const roleId = url.searchParams.get("role_id");
        const guild = await getSafeGuild(guildId);
        const role = await guild?.roles.fetch(roleId).catch(() => null);
        if (role) {
            const membersList = await guild.members.fetch({ role: roleId });
            const members = membersList.map(m => ({ id: m.id, name: m.user.globalName || m.user.username, avatar: m.user.displayAvatarURL({ size: 64 }) }));
            return resJson(res, { ok: true, members });
        }
        return resJson(res, { ok: false, error: "Role not found" }, 404);
    }

    return false;
}
