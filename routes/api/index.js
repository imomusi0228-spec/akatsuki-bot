import { getSession } from "../../middleware/auth.js";
import { ENV } from "../../config/env.js";
import { resJson } from "./helpers.js";

// Import modules
import { handleStatsRoutes } from "./stats.js";
import { handleSettingsRoutes } from "./settings.js";
import { handleTicketRoutes } from "./tickets.js";
import { handleModerationRoutes } from "./moderation.js";
import { handleGuildRoutes } from "./guilds.js";
import { handleEmbedRoutes } from "./embed.js";
import { handleButtonRoleRoutes } from "./button-roles.js";
import { handleSystemRoutes } from "./system.js";

export async function handleApiRoute(req, res, pathname, url) {
    const session = await getSession(req);
    const authHeader = req.headers.authorization;
    const adminToken = ENV.ADMIN_TOKEN;
    let isAdminApi = false;

    // Admin Token Bypass (for license updates, local management, etc)
    if (adminToken && (authHeader === `Bearer ${adminToken}` || authHeader === adminToken)) {
        isAdminApi = true;
    }

    // Auth Middleware for all API routes except public / receive
    if (!session && !isAdminApi && pathname !== "/api/updates/receive") {
        return resJson(res, { ok: false, error: "Unauthorized" }, 401);
    }

    // CSRF Protection for state-changing requests
    if (req.method !== "GET" && session && !isAdminApi) {
        const csrfHeader = req.headers["x-csrf-token"];
        if (!csrfHeader || csrfHeader !== session.csrfSecret) {
            console.warn(`[SECURITY] CSRF block: Path=${pathname}, SessionUID=${session.user?.id}`);
            return resJson(res, { ok: false, error: "Invalid CSRF Token" }, 403);
        }
    }

    // Route Routing
    // Instead of a giant switch, we use modular handlers.
    // Each handler returns 'false' if it doesn't handle the route.
    
    // 1. Stats
    if (await handleStatsRoutes(req, res, pathname, url, session)) return;
    // 2. Settings
    if (await handleSettingsRoutes(req, res, pathname, url, session)) return;
    // 3. Tickets
    if (await handleTicketRoutes(req, res, pathname, url, session)) return;
    // 4. Moderation
    if (await handleModerationRoutes(req, res, pathname, url, session)) return;
    // 5. Guilds / Meta
    if (await handleGuildRoutes(req, res, pathname, url, session)) return;
    // 6. Embeds
    if (await handleEmbedRoutes(req, res, pathname, url, session)) return;
    // 7. Button Roles
    if (await handleButtonRoleRoutes(req, res, pathname, url, session)) return;
    // 8. System Status
    if (await handleSystemRoutes(req, res, pathname, url, session)) return;

    // Default 404 for API
    return resJson(res, { ok: false, error: "API Route Not Found" }, 404);
}
