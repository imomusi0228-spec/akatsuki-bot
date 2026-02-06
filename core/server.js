import http from "node:http";
import { ENV } from "../config/env.js";
import { client } from "./client.js";
import { handleAuthRoute } from "../routes/auth.js";
import { handleApiRoute } from "../routes/api.js";
import { handleAdminRoute } from "../routes/admin.js";
import { renderPublicGuideHTML } from "../services/views.js";

export async function startServer() {
    const server = http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const pathname = url.pathname;

            // 1. OAuth & Auth Routes
            if (pathname.startsWith("/auth/") || pathname.startsWith("/login") || pathname.startsWith("/logout") || pathname.startsWith("/oauth/")) {
                return await handleAuthRoute(req, res, pathname, url);
            }

            // 2. API Routes
            if (pathname.startsWith("/api/")) {
                return await handleApiRoute(req, res, pathname, url);
            }

            // 3. Admin Routes
            if (pathname.startsWith("/admin")) {
                return await handleAdminRoute(req, res, pathname, url);
            }

            // 4. Public Pages
            if (pathname === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(renderPublicGuideHTML(req)); // Pass req for lang
                return;
            }

            // 5. Health Check (for Render/Deployment)
            if (pathname === "/health") {
                res.writeHead(200, { "Content-Type": "text/plain" });
                res.end("OK");
                return;
            }

            // 6. Debug Status (Diagnostic)
            if (pathname === "/debug/status") {
                const status = {
                    wsStatus: client.ws.status,
                    ping: client.ws.ping,
                    uptime: client.uptime,
                    user: client.user ? { tag: client.user.tag, id: client.user.id } : null,
                    guilds: client.guilds.cache.size,
                    readyAt: client.readyAt,
                };
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(status, null, 2));
                return;
            }

            // 404
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");

        } catch (e) {
            console.error("Server Error:", e);
            if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end("Internal Server Error");
            }
        }
    });

    return new Promise((resolve) => {
        server.listen(ENV.PORT, () => {
            console.log(`🌍 Web Server running on port ${ENV.PORT}`);
            if (ENV.PUBLIC_URL) console.log(`   Public URL: ${ENV.PUBLIC_URL}`);
            resolve();
        });
    });
}
