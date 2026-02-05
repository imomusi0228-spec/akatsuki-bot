import { ENV } from "../config/env.js";
import { getSession } from "../middleware/auth.js";
import { renderNeedLoginHTML, renderAdminDashboardHTML, renderAdminSettingsHTML, renderAdminActivityHTML } from "../services/views.js";

export async function handleAdminRoute(req, res, pathname, url) {
    // Token Login (for debugging or admin bypass)
    const token = url.searchParams.get("token");
    if (token && ENV.ADMIN_TOKEN && token === ENV.ADMIN_TOKEN) {
        // Fake session with admin user
        const sid = "admin_token_session";
        const { sessions, setCookie } = await import("../middleware/auth.js");

        sessions.set(sid, {
            accessToken: "mock_token",
            user: { id: "admin", username: "Admin", discriminator: "0000", global_name: "Administrator" },
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
        res.end(renderNeedLoginHTML({ oauthReady, tokenEnabled }));
        return;
    }

    const user = session.user;

    // Router
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    if (pathname === "/admin/dashboard") {
        const html = renderAdminDashboardHTML({ user, req });
        res.end(html);
    } else if (pathname === "/admin/settings") {
        const html = renderAdminSettingsHTML({ user, req });
        res.end(html);
    } else if (pathname === "/admin/activity") {
        const html = renderAdminActivityHTML({ user, req });
        res.end(html);
    } else {
        // Default: Dashboard if no other path matches
        const html = renderAdminDashboardHTML({ user, req });
        res.end(html);
    }
}
