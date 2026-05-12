import { resJson } from "./helpers.js";
import { client } from "../../core/client.js";
import { ENV } from "../../config/env.js";
import os from "node:os";

export async function handleSystemRoutes(req, res, pathname, url, session) {
    // GET /api/system/status (New Professional Feature)
    if (pathname === "/api/system/status" && req.method === "GET") {
        // Only allow if admin_token is provided or user is high-tier/admin (Simplified for now)
        const authHeader = req.headers.authorization;
        if (ENV.ADMIN_TOKEN && (authHeader === `Bearer ${ENV.ADMIN_TOKEN}` || authHeader === ENV.ADMIN_TOKEN)) {
            // Authorized via token
        } else if (!session) {
            return resJson(res, { ok: false, error: "Unauthorized" }, 401);
        }

        const memUsage = process.memoryUsage();
        const uptime = process.uptime();
        const cpuLoad = os.loadavg();

        return resJson(res, {
            ok: true,
            status: {
                uptime: Math.floor(uptime),
                memory: {
                    rss: Math.round(memUsage.rss / 1024 / 1024) + "MB",
                    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + "MB",
                },
                cpu: {
                    load: cpuLoad,
                },
                discord: {
                    shardCount: client.shard ? client.shard.count : 1,
                    guildCount: client.guilds.cache.size,
                    ping: client.ws.ping,
                },
                server: {
                    platform: os.platform(),
                    arch: os.arch(),
                    cores: os.cpus().length,
                }
            }
        });
    }

    return false;
}
