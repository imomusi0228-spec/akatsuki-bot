import { ENV } from "../config/env.js";
import { getSession } from "../middleware/auth.js";
import {
    renderLoginHTML,
    renderAdminDashboardHTML,
    renderAdminSettingsHTML,
    renderAdminActivityHTML,
    renderAdminAntiraidHTML,
    renderAdminTicketsHTML,
} from "../services/views.js";
import { getTier, getUserTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { verifyGuild, PERMISSION_LEVELS } from "./api/helpers.js";

export async function handleAdminRoute(req, res, pathname, url) {
    // Token Login (for debugging or admin bypass)
    const token = url.searchParams.get("token");
    if (token && ENV.ADMIN_TOKEN && token === ENV.ADMIN_TOKEN) {
        // Fake session with admin user
        const sid = "admin_token_session";
        const { sessions, setCookie } = await import("../middleware/auth.js");

        sessions.set(sid, {
            accessToken: "mock_token",
            user: {
                id: "admin",
                username: "Admin",
                discriminator: "0000",
                global_name: "Administrator",
            },
            expiresAt: Date.now() + 3600000,
            guilds: [], // Empty guilds for mock
        });
        setCookie(res, "sid", sid, { maxAge: 3600 });

        res.writeHead(302, { Location: "/admin/dashboard" });
        res.end();
        return;
    }

    // Regular Session Check
    const session = await getSession(req);
    const oauthReady = !!(ENV.CLIENT_ID && ENV.CLIENT_SECRET);
    const tokenEnabled = !!ENV.ADMIN_TOKEN;

    // Not logged in
    if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(await renderLoginHTML(req, url));
        return;
    }

    const user = session.user;
    const userTier = await getUserTier(user.id);

    let permissionLevel = PERMISSION_LEVELS.NONE;
    const guildId = url.searchParams.get("guild");
    if (guildId) {
        const guildTier = await getTier(guildId);
        const features = getFeatures(guildTier, guildId, userTier);
        
        if (!features.dashboard) {
            // Neither server nor user has dashboard access
            res.writeHead(302, { Location: "/?msg=upgrade_required" });
            res.end();
            return;
        }

        const v = await verifyGuild(guildId, session);
        if (!v) {
            // No permission even for moderator
            res.writeHead(302, { Location: "/admin/dashboard?msg=forbidden" });
            res.end();
            return;
        }
        permissionLevel = v.level;
    } else {
        // No guild selected yet, or default view. 
        // We'll let the frontend handle the initial guild selection.
        permissionLevel = PERMISSION_LEVELS.MODERATOR; 
    }

    const renderData = { user, req, url, userTier, permissionLevel };

    // Router
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    
    let html;
    if (pathname === "/admin/dashboard") {
        html = await renderAdminDashboardHTML({ ...renderData, url });
    } else if (pathname === "/admin/settings") {
        html = await renderAdminSettingsHTML({ ...renderData, url });
    } else if (pathname === "/admin/tickets") {
        html = await renderAdminTicketsHTML({ ...renderData, url });
    } else if (pathname === "/admin/activity") {
        html = await renderAdminActivityHTML({ ...renderData, url });
    } else if (pathname === "/admin/antiraid") {
        html = await renderAdminAntiraidHTML({ ...renderData, url });
    } else if (pathname === "/admin/branding") {
        const { renderAdminBrandingHTML } = await import("../services/views.js");
        html = await renderAdminBrandingHTML({ ...renderData, url });
    } else if (pathname === "/admin/ai") {
        const { renderAdminAiHTML } = await import("../services/views.js");
        html = await renderAdminAiHTML({ ...renderData, url });
    } else {
        // Default: Dashboard if no other path matches
        html = await renderAdminDashboardHTML({ ...renderData, url });
    }
    
    res.end(html);
}
