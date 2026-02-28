import { dbQuery } from "../core/db.js";
import { getSession, discordApi } from "../middleware/auth.js";
import fs from "fs";
import path from "path";
import {
    PermissionFlagsBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from "discord.js";
import { client } from "../core/client.js";
import { TIERS, FEATURES, getFeatures, TIER_NAMES, TIER_COLORS } from "../core/tiers.js";
import { getTier, getSubscriptionInfo } from "../core/subscription.js";
import { ENV } from "../config/env.js";

function hasManageGuild(permissions, owner = false) {
    if (owner === true) return true;
    const MANAGE_GUILD = 0x20n;
    const ADMINISTRATOR = 0x8n;
    const p = BigInt(permissions || "0");
    return (p & MANAGE_GUILD) === MANAGE_GUILD || (p & ADMINISTRATOR) === ADMINISTRATOR;
}

// Helper: Cache import and usage
import { cache } from "../core/cache.js";

export async function handleApiRoute(req, res, pathname, url) {
    // Check for API Key (Admin Token) for backend routes
    const authHeader = req.headers.authorization;
    const adminToken = ENV.ADMIN_TOKEN;
    let isAdminApi = false;

    const session = await getSession(req);

    // POST /api/updates/receive support (checking both header and body later, but mark as potential admin for now)
    if (pathname === "/api/updates/receive" || pathname === "/api/license/update") {
        if (adminToken && (authHeader === `Bearer ${adminToken}` || authHeader === adminToken)) {
            isAdminApi = true;
        }
    }

    if (!session && !isAdminApi && pathname !== "/api/updates/receive") {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Unauthorized" }));
        return;
    }

    const method = req.method;

    // Enforce CSRF Protection for state-changing requests (except Admin API)
    if (method !== "GET" && session && !isAdminApi) {
        const csrfHeader = req.headers["x-csrf-token"];
        if (!csrfHeader || csrfHeader !== session.csrfSecret) {
            console.warn(
                `[SECURITY] CSRF block: Path=${pathname}, Header=${csrfHeader}, SessionSecret=${session.csrfSecret ? "Exists" : "Missing"}`
            );

            res.writeHead(403, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    ok: false,
                    error: "Invalid or missing CSRF Token. Please refresh the page.",
                })
            );
            return;
        }
    }

    // Response Helpers
    const resJson = (data, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
    };

    const getBody = async () => {
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

    // GET /api/guilds
    if (pathname === "/api/guilds") {
        try {
            let userGuilds;

            const refresh = url.searchParams.get("refresh") === "true";

            // Use global cache or session cache first unless refresh is requested
            const globalCache = !refresh ? cache.getUserGuilds(session.user.id) : null;
            if (globalCache) {
                userGuilds = globalCache;
                session.guilds = globalCache;
            } else if (!refresh && Array.isArray(session.guilds) && session.guilds.length > 0) {
                userGuilds = session.guilds;
                cache.setUserGuilds(session.user.id, userGuilds); // Sync back to global
            } else {
                // Fetch from Discord with retry on 429
                let attempt = 0;
                while (attempt < 7) {
                    const result = await discordApi(session.accessToken, "/users/@me/guilds");
                    if (Array.isArray(result)) {
                        userGuilds = result;
                        session.guilds = result; // Cache in session
                        cache.setUserGuilds(session.user.id, result); // Cache globally
                        break;
                    }

                    // Handle 429 Rate Limit
                    if (result?.status === 429) {
                        const retryAfter = result.retry_after || 1;
                        console.warn(
                            `[API WARN] Rate limited on /api/guilds, retrying after ${retryAfter}s... (Attempt ${attempt + 1})`
                        );
                        await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 500));
                        attempt++;
                        continue;
                    }

                    throw new Error(result?.message || "Failed to fetch guilds from Discord");
                }
                if (!userGuilds) throw new Error("Failed to fetch guilds after retries");
            }

            const managedGuilds = userGuilds.filter((g) => hasManageGuild(g.permissions, g.owner));

            // bot のキャッシュにあるか確認。なければ Discord API から fetch してチェック
            const availableGuilds = (
                await Promise.all(
                    managedGuilds.map(async (g) => {
                        if (client.guilds.cache.has(g.id))
                            return { id: g.id, name: g.name, icon: g.icon };
                        try {
                            const fetched = await client.guilds.fetch(g.id).catch(() => null);
                            if (fetched) return { id: g.id, name: g.name, icon: g.icon };
                        } catch (_) {}
                        return null;
                    })
                )
            ).filter(Boolean);

            // console.log(`[API INFO] /api/guilds: Found ${availableGuilds.length} available guilds`);
            resJson({ ok: true, guilds: availableGuilds });
        } catch (e) {
            console.error(`[API ERROR] /api/guilds:`, e.message);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // Helper: Get guild with fetch fallback if cache is empty
    const getSafeGuild = async (gid) => {
        if (!gid) return null;
        return client.guilds.cache.get(gid) || (await client.guilds.fetch(gid).catch(() => null));
    };

    // Helper: Verify guild ownership and permissions
    const verifyGuild = async (guildId) => {
        if (!guildId) return false;

        try {
            // bot がそのサーバーに参加しているか確認（キャッシュにない場合は fetch で確認）
            const guild = await getSafeGuild(guildId);
            if (!guild) return false;

            // Use global or session cache if available
            const globalCache = cache.getUserGuilds(session.user.id);
            if (globalCache) {
                session.guilds = globalCache;
            } else if (!Array.isArray(session.guilds) || session.guilds.length === 0) {
                let attempt = 0;
                while (attempt < 7) {
                    const userGuilds = await discordApi(session.accessToken, "/users/@me/guilds");
                    if (Array.isArray(userGuilds)) {
                        session.guilds = userGuilds; // Cache in session
                        cache.setUserGuilds(session.user.id, userGuilds); // Cache globally
                        break;
                    }

                    if (userGuilds?.status === 429) {
                        const retryAfter = userGuilds.retry_after || 1;
                        console.warn(
                            `[API WARN] verifyGuild: Rate limited, retrying after ${retryAfter}s... (Attempt ${attempt + 1})`
                        );
                        await new Promise((r) => setTimeout(r, Math.ceil(retryAfter * 1000) + 500));
                        attempt++;
                        continue;
                    }

                    console.error(
                        `[AUTH ERROR] Failed to fetch guilds for user ${session.user.id}:`,
                        userGuilds
                    );
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

    const guildId = url.searchParams.get("guild");
    const monthParam = url.searchParams.get("month"); // YYYY-MM

    // GET /api/stats
    if (pathname === "/api/stats") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // 1. Fetch Tier & Subscription first to determine stats range
            const [tier, subRes] = await Promise.all([
                getTier(guildId),
                dbQuery("SELECT valid_until FROM subscriptions WHERE guild_id = $1", [guildId]),
            ]);

            const features = getFeatures(tier, guildId, session.user.id);
            const statsDays = features.longTermStats ? 30 : 7;
            const periodInterval = `${statsDays} days`;

            // 2. Execute Stats Queries
            const [vcRes, ngCountRes, ngTopRes, leaveRes, timeoutRes] = await Promise.all([
                dbQuery(
                    "SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time > NOW() - $2::INTERVAL",
                    [guildId, periodInterval]
                ),
                dbQuery(
                    "SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - $2::INTERVAL",
                    [guildId, periodInterval]
                ),
                dbQuery(
                    "SELECT user_id, COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - $2::INTERVAL GROUP BY user_id ORDER BY cnt DESC LIMIT 5",
                    [guildId, periodInterval]
                ),
                dbQuery(
                    "SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'leave' AND created_at > NOW() - $2::INTERVAL",
                    [guildId, periodInterval]
                ),
                dbQuery(
                    "SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'timeout' AND created_at > NOW() - $2::INTERVAL",
                    [guildId, periodInterval]
                ),
            ]);

            const subData = {
                tier,
                valid_until: subRes.rows[0]?.valid_until || null,
                color: TIER_COLORS[tier] || TIER_COLORS[TIERS.FREE],
            };

            // Get guild for member fetching
            const guild = await getSafeGuild(guildId);

            // Enrich with Discord Data
            const topUsers = await Promise.all(
                ngTopRes.rows.map(async (row) => {
                    let user = client.users.cache.get(row.user_id);
                    if (!user) {
                        try {
                            user = await Promise.race([
                                client.users.fetch(row.user_id),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error("Timeout")), 500)
                                ),
                            ]);
                        } catch (e) {}
                    }
                    // Fetch member to check timeout status
                    let member = null;
                    if (guild) {
                        try {
                            member = await guild.members.fetch(row.user_id).catch(() => null);
                        } catch (e) {}
                    }

                    return {
                        user_id: row.user_id,
                        display_name: user ? user.globalName || user.username : "Unknown User",
                        avatar_url: user ? user.displayAvatarURL({ size: 64 }) : null,
                        cnt: row.cnt,
                        is_timed_out:
                            member &&
                            member.communicationDisabledUntil &&
                            member.communicationDisabledUntil > new Date(),
                    };
                })
            );

            resJson({
                ok: true,
                subscription: {
                    tier: subData.tier,
                    name: TIER_NAMES[subData.tier],
                    color: subData.color,
                    features,
                    valid_until: subData.valid_until,
                },
                stats: {
                    summary: {
                        joins: vcRes.rows[0]?.cnt || 0,
                        leaves: leaveRes.rows[0]?.cnt || 0,
                        timeouts: timeoutRes.rows[0]?.cnt || 0,
                        ngDetected: parseInt(ngCountRes.rows[0]?.cnt || 0),
                    },
                    topNgUsers: topUsers,
                },
            });
        } catch (error) {
            console.error("Dashboard Stats Error:", error.message);
            resJson({ ok: false, error: error.message }, 500);
        }
        return;
    }

    // GET /api/stats/heatmap (Pro)
    if (pathname === "/api/stats/heatmap") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const tier = await getTier(guildId);
            const features = getFeatures(tier, guildId, session.user.id);
            const statsDays = features.longTermStats ? 30 : 7;
            const periodInterval = `${statsDays} days`;

            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonthRaw = new Date(date.getFullYear(), date.getMonth(), 1);

            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - statsDays);

            const startOfMonth = startOfMonthRaw < limitDate ? limitDate : startOfMonthRaw;
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            const [heatmapRes, msgHeatmapRes] = await Promise.all([
                dbQuery(
                    `
                    SELECT 
                        EXTRACT(HOUR FROM join_time AT TIME ZONE 'Asia/Tokyo') as hour_of_day,
                        SUM(COALESCE(duration_seconds, EXTRACT(EPOCH FROM (NOW() - join_time)))) / 60 as total_minutes
                    FROM vc_sessions
                    WHERE guild_id = $1 
                      AND join_time >= $2 AND join_time <= $3
                    GROUP BY hour_of_day
                `,
                    [guildId, startOfMonth, endOfMonth]
                ),
                dbQuery(
                    `
                    SELECT 
                        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour_of_day,
                        COUNT(*) as cnt
                    FROM member_events
                    WHERE guild_id = $1 AND event_type = 'message'
                      AND created_at >= $2 AND created_at <= $3
                    GROUP BY hour_of_day
                `,
                    [guildId, startOfMonth, endOfMonth]
                ),
            ]);

            const heatmap = Array(24).fill(0);
            heatmapRes.rows.forEach((r) => {
                heatmap[parseInt(r.hour_of_day)] = Math.round(parseFloat(r.total_minutes));
            });

            const msg_heatmap = Array(24).fill(0);
            msgHeatmapRes.rows.forEach((r) => {
                msg_heatmap[parseInt(r.hour_of_day)] = parseInt(r.cnt);
            });

            resJson({ ok: true, heatmap, msg_heatmap, ng_heatmap: msg_heatmap }); // keep ng_heatmap for temporary compatibility
        } catch (e) {
            console.error("Heatmap Error:", e);
            return resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // POST /api/embed/send (New feature for Embed Builder)
    if (pathname === "/api/embed/send" && method === "POST") {
        const body = await getBody();
        const {
            guild: guildId,
            channel_id: channelId,
            title,
            description,
            color,
            footer,
            image,
        } = body;

        if (!guildId || !channelId)
            return resJson({ ok: false, error: "Missing guild or channel" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(guildId);
            if (!guild) return resJson({ ok: false, error: "Guild not found" }, 404);

            const channel = guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased())
                return resJson({ ok: false, error: "Text channel not found" }, 404);

            const { EmbedBuilder } = await import("discord.js");
            const embed = new EmbedBuilder()
                .setTitle(title || null)
                .setDescription(description || null)
                .setColor(color || "#5865F2")
                .setFooter(footer ? { text: footer } : null)
                .setImage(image || null)
                .setTimestamp();

            await channel.send({ embeds: [embed] });
            return resJson({ ok: true });
        } catch (e) {
            console.error("Embed Send Error:", e);
            return resJson({ ok: false, error: e.message }, 500);
        }
    }

    // GET /api/stats/growth (Pro/Pro+)
    if (pathname === "/api/stats/growth") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        const tier = await getTier(guildId);
        const features = getFeatures(tier);
        if (!features.dashboard) {
            return resJson({ ok: false, error: "Pro tier required" }, 403);
        }

        try {
            const statsDays = features.longTermStats ? 30 : 7;
            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonthRaw = new Date(date.getFullYear(), date.getMonth(), 1);

            // Apply strict limit
            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - statsDays);
            const startOfMonth = startOfMonthRaw < limitDate ? limitDate : startOfMonthRaw;

            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            // Member join/leave trends per day
            const growthRes = await dbQuery(
                `
                SELECT 
                    DATE(created_at AT TIME ZONE 'Asia/Tokyo') as date,
                    event_type,
                    COUNT(*) as count
                FROM member_events
                WHERE guild_id = $1 
                  AND created_at >= $2 AND created_at <= $3
                GROUP BY date, event_type
                ORDER BY date
            `,
                [guildId, startOfMonth, endOfMonth]
            );

            resJson({ ok: true, events: growthRes.rows });
        } catch (e) {
            console.error("Growth Stats Error:", e);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // GET /api/leaderboard (v2.8.2)
    if (pathname === "/api/leaderboard") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const statsRes = await dbQuery(
                `
                SELECT user_id, xp, level, message_count, total_vc_minutes
                FROM member_stats
                WHERE guild_id = $1
                ORDER BY xp DESC
                LIMIT 10
            `,
                [guildId]
            );

            const guild = await getSafeGuild(guildId);
            const leaderboard = await Promise.all(
                statsRes.rows.map(async (row) => {
                    let user = client.users.cache.get(row.user_id);
                    if (!user) {
                        try {
                            user = await Promise.race([
                                client.users.fetch(row.user_id),
                                new Promise((_, reject) =>
                                    setTimeout(() => reject(new Error("Timeout")), 500)
                                ),
                            ]);
                        } catch (e) {}
                    }
                    return {
                        user_id: row.user_id,
                        display_name: user ? user.globalName || user.username : "Unknown User",
                        avatar_url: user ? user.displayAvatarURL({ size: 64 }) : null,
                        xp: row.xp,
                        level: row.level,
                        message_count: row.message_count,
                        vc_minutes: row.total_vc_minutes,
                    };
                })
            );

            resJson({ ok: true, leaderboard });
        } catch (e) {
            console.error("Leaderboard API Error:", e);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // GET /api/ngwords
    if (pathname === "/api/ngwords") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, words: resDb.rows }));
        return;
    }

    // POST /api/ngwords/add
    if (pathname === "/api/ngwords/add" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.word) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        const rawWords = body.word.split(/\s+/).filter((w) => w.trim().length > 0);
        if (rawWords.length === 0) return res.end(JSON.stringify({ ok: false }));

        const tier = await getTier(body.guild);
        const features = getFeatures(tier);

        // Get existing words to filter duplicates
        const existingRes = await dbQuery("SELECT word FROM ng_words WHERE guild_id = $1", [
            body.guild,
        ]);
        const existingSet = new Set(existingRes.rows.map((r) => r.word));

        // Filter valid new words
        const uniqueNewWords = [...new Set(rawWords.filter((w) => !existingSet.has(w)))];

        if (uniqueNewWords.length === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: true, message: "No new words to add" }));
        }

        if (existingSet.size + uniqueNewWords.length > features.maxNgWords) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(
                JSON.stringify({
                    ok: false,
                    error: `Limit exceeded. Can't add ${uniqueNewWords.length} words (Max ${features.maxNgWords}).`,
                })
            );
        }

        for (const w of uniqueNewWords) {
            const isRegex = w.startsWith("/") && w.endsWith("/");
            await dbQuery(
                "INSERT INTO ng_words (guild_id, word, kind, created_by) VALUES ($1, $2, $3, 'Web')",
                [body.guild, w, isRegex ? "regex" : "exact"]
            );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // POST /api/ngwords/remove
    if (pathname === "/api/ngwords/remove" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.word) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Automatic Timeout Release Logic
            const tier = await getTier(body.guild);
            const features = getFeatures(tier);

            if (features.autoRelease) {
                // 1. Find users who were logged for this specific word
                const logRes = await dbQuery(
                    "SELECT DISTINCT user_id FROM ng_logs WHERE guild_id = $1 AND word = $2",
                    [body.guild, body.word]
                );
                const userIds = logRes.rows.map((r) => r.user_id);

                if (userIds.length > 0) {
                    const guild = await getSafeGuild(body.guild);
                    if (guild) {
                        // Process concurrently but catch errors individually
                        await Promise.all(
                            userIds.map(async (userId) => {
                                try {
                                    const member = await guild.members
                                        .fetch(userId)
                                        .catch(() => null);
                                    if (member && member.isCommunicationDisabled()) {
                                        await member.timeout(
                                            null,
                                            `NG Word "${body.word}" deleted by admin`
                                        );
                                        // console.log(`[Auto-Release] Removed timeout...`);
                                    }
                                } catch (e) {
                                    console.error(
                                        `[Auto-Release] Failed for user ${userId}:`,
                                        e.message
                                    );
                                }
                            })
                        );
                    }
                }
            } else {
                // console.log(`[Auto-Release] Skipped...`);
            }

            await dbQuery("DELETE FROM ng_words WHERE guild_id = $1 AND word = $2", [
                body.guild,
                body.word,
            ]);
            // Also delete logs for this word (User request: History should not remain)
            await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1 AND word = $2", [
                body.guild,
                body.word,
            ]);

            resJson({ ok: true });
        } catch (e) {
            console.error("Remove NG Word Error:", e);
            resJson({ ok: false, error: "Internal Error" }, 500);
        }
        return;
    }

    // POST /api/ngwords/clear
    if (pathname === "/api/ngwords/clear" && method === "POST") {
        const body = await getBody();
        if (!body.guild) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1", [body.guild]);
        await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1", [body.guild]);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // GET /api/settings
    if (pathname === "/api/settings") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery(
            `
            SELECT 
                guild_id, log_channel_id, ng_log_channel_id, audit_role_id, intro_channel_id,
                ng_threshold, timeout_minutes, autorole_id, autorole_enabled,
                antiraid_enabled, antiraid_threshold, antiraid_guard_level,
                self_intro_enabled, self_intro_role_id, self_intro_min_length,
                vc_report_enabled, vc_report_channel_id, vc_report_interval,
                vc_role_rules, last_announced_version, alpha_features,
                raid_join_threshold, newcomer_restrict_mins, newcomer_min_account_age,
                link_block_enabled, domain_blacklist, auto_slowmode_channels,
                ai_advice_days, ai_advice_channel_id, ai_insight_enabled,
                ai_insight_channel_id, insight_sections,
                phase2_threshold, phase2_action, phase3_threshold, phase3_action,
                phase4_threshold, phase4_action, intro_reminder_hours,
                report_channel_id, ng_warning_enabled, ticket_welcome_msg,
                color_log, color_ng, color_vc_join, color_vc_leave,
                color_level, color_ticket, dashboard_theme_color,
                dashboard_theme_mode, ai_prediction_enabled,
                auto_vc_creator_id, ticket_staff_role_id,
                auto_action_on_warns, warn_action_threshold, warn_action,
                leaderboard_enabled, levelup_enabled, levelup_channel_id,
                welcome_enabled, welcome_channel_id, welcome_message,
                farewell_enabled, farewell_channel_id, farewell_message,
                mod_log_channel_id, mod_log_flags
            FROM settings 
            WHERE guild_id = $1
        `,
            [guildId]
        );
        const subInfo = await getSubscriptionInfo(guildId);

        const settings = resDb.rows[0] || {};
        // Ensure alpha_features is always an array
        if (!settings.alpha_features) settings.alpha_features = [];

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                ok: true,
                settings: settings,
                subscription: subInfo,
            })
        );
        return;
    }

    // GET /api/channels
    if (pathname === "/api/channels") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);
        const guild = await getSafeGuild(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        const channels = guild.channels.cache.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
        }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, channels }));
        return;
    }

    // GET /api/roles
    if (pathname === "/api/roles") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);
        const guild = await getSafeGuild(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        const roles = guild.roles.cache
            .filter((r) => r.name !== "@everyone" && !r.managed)
            .map((r) => ({ id: r.id, name: r.name }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, roles }));
        return;
    }

    // GET /api/roles/members
    if (pathname === "/api/roles/members") {
        const guildId = url.searchParams.get("guild");
        const roleId = url.searchParams.get("role_id");
        if (!guildId || !roleId) return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(guildId);
            if (!guild) return resJson({ ok: false, error: "Guild not found" }, 404);

            const role = await guild.roles.fetch(roleId).catch(() => null);
            if (!role) return resJson({ ok: false, error: "Role not found" }, 404);

            // Force fetch members of the role to avoid cache issues (v2.4.8)
            const membersList = await guild.members.fetch({ role: roleId });
            const members = membersList.map((m) => ({
                id: m.id,
                name: m.user.globalName || m.user.username,
                avatar: m.user.displayAvatarURL({ size: 64 }),
            }));

            return resJson({ ok: true, members });
        } catch (e) {
            console.error("Fetch Role Members Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // POST /api/settings/update (Improved)
    if (pathname === "/api/settings/update" && method === "POST") {
        const body = await getBody();
        if (!body.guild) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        // Partially Dynamic Upsert
        try {
            const allowedFields = [
                "log_channel_id",
                "ng_log_channel_id",
                "audit_role_id",
                "intro_channel_id",
                "ng_threshold",
                "timeout_minutes",
                "antiraid_enabled",
                "antiraid_threshold",
                "self_intro_enabled",
                "self_intro_role_id",
                "self_intro_min_length",
                "vc_report_enabled",
                "vc_report_channel_id",
                "vc_report_interval",
                "vc_role_rules",
                "antiraid_guard_level",
                "raid_join_threshold",
                "newcomer_restrict_mins",
                "newcomer_min_account_age",
                "link_block_enabled",
                "domain_blacklist",
                "ai_advice_days",
                "ai_advice_channel_id",
                "ai_insight_enabled",
                "ai_insight_channel_id",
                "insight_sections",
                "phase2_threshold",
                "phase2_action",
                "phase3_threshold",
                "phase3_action",
                "phase4_threshold",
                "phase4_action",
                "intro_reminder_hours",
                "report_channel_id",
                "ng_warning_enabled",
                "ticket_welcome_msg",
                "color_log",
                "color_ng",
                "color_vc_join",
                "color_vc_leave",
                "color_level",
                "color_ticket",
                "dashboard_theme_color",
                "dashboard_theme_mode",
                "ai_prediction_enabled",
                "ai_predict_channel_id",
                "auto_vc_creator_id",
                "ticket_staff_role_id",
                "ticket_log_channel_id",
                "antiraid_auto_recovery_enabled",
                "antiraid_honeypot_channel_id",
                "antiraid_avatar_scrutiny_enabled",
                "auto_action_on_warns",
                "warn_action_threshold",
                "warn_action",
                "leaderboard_enabled",
                "levelup_enabled",
                "levelup_channel_id",
                "welcome_enabled",
                "welcome_channel_id",
                "welcome_message",
                "farewell_enabled",
                "farewell_channel_id",
                "farewell_message",
                "mod_log_channel_id",
                "mod_log_flags",
            ];

            const keys = Object.keys(body).filter((k) => allowedFields.includes(k));
            if (keys.length === 0) return resJson({ ok: true });

            const values = keys.map((k) => {
                const val = body[k];
                // Handle JSON serialization for specific fields
                if (["vc_role_rules", "domain_blacklist", "insight_sections"].includes(k)) {
                    return JSON.stringify(
                        val ||
                            (k === "domain_blacklist"
                                ? []
                                : k === "insight_sections"
                                  ? ["growth", "toxicity", "vc"]
                                  : [])
                    );
                }
                return val;
            });

            const placeholders = keys.map((_, i) => `$${i + 2}`).join(", ");
            const updateSet = keys.map((k, i) => `${k} = EXCLUDED.${k}`).join(", ");

            await dbQuery(
                `
                INSERT INTO settings (guild_id, ${keys.join(", ")}, updated_at)
                VALUES ($1, ${placeholders}, NOW())
                ON CONFLICT (guild_id) DO UPDATE SET
                    ${updateSet},
                    updated_at = NOW();
            `,
                [body.guild, ...values]
            );
        } catch (e) {
            console.error("Settings Update Error:", e);
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "Database Error" }));
        }

        // Proactively create Auto-VC trigger if missing
        if (body.auto_vc_creator_id) {
            try {
                const { ChannelType } = await import("discord.js");
                const guild = await getSafeGuild(body.guild);
                if (guild) {
                    const category = await guild.channels
                        .fetch(body.auto_vc_creator_id)
                        .catch(() => null);
                    if (category && category.type === ChannelType.GuildCategory) {
                        const vcs = guild.channels.cache.filter(
                            (c) => c.parentId === category.id && c.type === ChannelType.GuildVoice
                        );
                        if (vcs.size === 0) {
                            await guild.channels.create({
                                name: "➕ 部屋作成",
                                type: ChannelType.GuildVoice,
                                parent: category.id,
                            });
                            // console.log(`[AUTO-VC] Created missing trigger...`);
                        }
                    }
                }
            } catch (err) {
                console.error("Auto-VC Trigger Creation Error:", err);
            }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: true }));
    }

    // GET /api/activity
    if (pathname === "/api/activity") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        // Check Tier
        const tier = await getTier(guildId);
        const features = getFeatures(tier);

        if (!features.audit) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(
                JSON.stringify({ ok: false, error: "Upgrade to Pro+ required for Activity Audit." })
            );
        }

        // Inactivity Logic: Users who haven't joined VC or sent message (we don't track msg time in DB)
        // Only have VC tracking.
        // Let's return Mock data or VC data?
        // Real implementation: Fetch guild members, check `joinedAt` and compare with simple threshold.
        // Use discord.js cache to find members.

        const guild = await getSafeGuild(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        // 1. Get Audit Settings (Allow overrides from query)
        const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guildId]);
        const dbSettings = settingsRes.rows[0] || {};
        const settings = {
            audit_role_id: url.searchParams.get("audit_role_id") || dbSettings.audit_role_id,
            intro_channel_id:
                url.searchParams.get("intro_channel_id") || dbSettings.intro_channel_id,
        };

        const vcWeeks = parseInt(url.searchParams.get("vc_weeks")) || 0;

        // 2. Fetch Activity from member_stats for ALL members
        const activityMap = {};
        const statsRes = await dbQuery(
            "SELECT user_id, last_activity_at, total_vc_minutes FROM member_stats WHERE guild_id = $1",
            [guildId]
        );
        statsRes.rows.forEach((r) => {
            activityMap[r.user_id] = {
                last_act: r.last_activity_at,
                total_min: r.total_vc_minutes,
            };
        });

        const introSet = new Set();
        // 3. Scan Intro Channel (Last 100 messages) to find who introduced
        const introCacheKey = `intro_${settings.intro_channel_id}`;
        const cachedIntroIds = cache.getIntros(introCacheKey);

        if (cachedIntroIds) {
            cachedIntroIds.forEach((id) => introSet.add(id));
        } else if (settings.intro_channel_id) {
            try {
                const channel =
                    client.channels.cache.get(settings.intro_channel_id) ||
                    (await guild.channels.fetch(settings.intro_channel_id).catch(() => null));
                if (channel && channel.isTextBased()) {
                    let lastId = null;
                    let fetchCount = 0;
                    // Full scan: Fetch up to 1000 messages
                    while (fetchCount < 1000) {
                        const msgs = await channel.messages
                            .fetch({ limit: 100, before: lastId })
                            .catch(() => null);
                        if (!msgs || msgs.size === 0) break;
                        msgs.forEach((msg) => introSet.add(msg.author.id));
                        lastId = msgs.last().id;
                        fetchCount += msgs.size;
                        if (msgs.size < 100) break;
                    }
                    cache.setIntros(introCacheKey, Array.from(introSet));
                }
            } catch (e) {
                console.error("Intro Scan Error:", e);
            }
        }
        const auditResults = [];
        try {
            let members;
            const cacheKey = `members_${guildId}`;
            const cachedMembers = cache.getMembers(cacheKey);
            const refresh = url.searchParams.get("refresh") === "1";

            if (!refresh && cachedMembers) {
                members = cachedMembers;
            } else {
                try {
                    members = await guild.members.fetch();
                    cache.setMembers(cacheKey, members);
                } catch (fetchErr) {
                    // Check if we have cached data even if it's old (Stale-while-error)
                    if (
                        cachedMembers &&
                        (fetchErr.name === "GatewayRateLimitError" ||
                            fetchErr.code === 50035 ||
                            String(fetchErr).includes("rate limited"))
                    ) {
                        console.warn(
                            `[Activity Scan] Rate limited, using stale cache for guild ${guildId}`
                        );
                        members = cachedMembers;
                    } else if (
                        fetchErr.name === "GatewayRateLimitError" ||
                        fetchErr.code === 50035 ||
                        String(fetchErr).includes("rate limited")
                    ) {
                        const retryAfter = fetchErr.data?.retry_after || 5;
                        console.warn(
                            `[Activity Scan] Rate limited! Retry after ${retryAfter}s. Guild: ${guildId}`
                        );
                        res.writeHead(429, {
                            "Content-Type": "application/json",
                            "Retry-After": retryAfter,
                        });
                        return res.end(
                            JSON.stringify({
                                ok: false,
                                error: "Rate limited by Discord. Please try again in a few seconds.",
                                retry_after: retryAfter,
                            })
                        );
                    } else {
                        throw fetchErr;
                    }
                }
            }

            members.forEach((m) => {
                if (m.user.bot) return;

                const inVcNow = m.voice?.channelId;
                const userStats = activityMap[m.id] || { last_act: null, total_min: 0 };
                let lastActDate = userStats.last_act;

                // If currently in VC, treat as NOW (overrides DB null)
                if (inVcNow) lastActDate = new Date();

                const hasRole = settings.audit_role_id
                    ? m.roles.cache.has(settings.audit_role_id)
                    : true;
                const hasIntro = settings.intro_channel_id ? introSet.has(m.user.id) : true;

                // VC Threshold Check (using last_activity_at as a proxy for 'active')
                let vcOk = !!(lastActDate || inVcNow);
                if (vcWeeks > 0 && lastActDate) {
                    const thresholdDate = new Date();
                    thresholdDate.setDate(thresholdDate.getDate() - vcWeeks * 7);
                    if (new Date(lastActDate) < thresholdDate) vcOk = false;
                }

                // Audit Status Logic:
                let status = "OK";
                if (!hasRole || !hasIntro || !vcOk) status = "NG";

                const fmtDate = (d) => {
                    if (!d) return "None";
                    const dateObj = d instanceof Date ? d : new Date(d);
                    return isNaN(dateObj.getTime()) ? "None" : dateObj.toISOString().split("T")[0];
                };

                auditResults.push({
                    id: m.id,
                    display_name: m.displayName,
                    avatar_url: m.user.displayAvatarURL(),
                    has_role: hasRole,
                    has_intro: hasIntro,
                    last_vc: fmtDate(lastActDate),
                    total_vc_hours: (userStats.total_min / 60).toFixed(1),
                    joined_at: m.joinedAt ? m.joinedAt.toISOString().split("T")[0] : "Unknown",
                    status: status,
                });
            });
        } catch (e) {
            console.error("Activity Scan Error:", e);
        }

        const sub = await getSubscriptionInfo(guildId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
            JSON.stringify({
                ok: true,
                subscription: sub,
                data: auditResults.sort((a, b) => (a.status === "NG" ? -1 : 1)), // NG first
            })
        );
        return;
    }

    // POST /api/license/update (Improved with per-user server limit)
    if (pathname === "/api/license/update" && method === "POST") {
        try {
            const body = await getBody();
            if (!body.guild || body.tier === undefined || !body.user_id) {
                return res.end(JSON.stringify({ ok: false, error: "Missing required fields" }));
            }

            const targetTier = parseInt(body.tier);
            const features = getFeatures(targetTier);
            // Check how many servers the user already has at this tier (or higher, for safety)
            if (targetTier > 0) {
                // Fix: Fetch all user subscriptions and filter in JS to avoid SQL casting errors on mixed string/int 'tier' column
                const usageRes = await dbQuery(
                    "SELECT tier, guild_id FROM subscriptions WHERE user_id = $1",
                    [body.user_id]
                );

                const currentUsage = usageRes.rows.filter((r) => {
                    if (r.guild_id === body.guild) return false; // Exclude current guild if upgrading

                    // Handle mixed types (int or "Trial Pro")
                    let tierVal = parseInt(r.tier);
                    if (isNaN(tierVal)) {
                        // If logic ever needs to handle "Trial Pro" string as a value, do it here.
                        // For now, assume strings are effectively tier 0 or legacy, so ignore if we are checking >= targetTier (and targetTier is usually > 0)
                        // Actually, if existing is "Trial Pro" (6), we should probably treat it as 6?
                        // Let's assume strings are lower precedence or legacy if not parseable to int?
                        // "Trial Pro" -> NaN.
                        // Let's rely on standard logic: if it's not a number, it doesn't count towards the limit of "Pro" servers?
                        // But wait! If user has "Trial Pro" string in DB, and effectively checking against Trial Pro limit...
                        // Let's try to map known strings.
                        if (r.tier === "Trial Pro") tierVal = TIERS.TRIAL_PRO;
                        else if (r.tier === "Trial Pro+") tierVal = TIERS.TRIAL_PRO_PLUS;
                        else return false; // Unknown string tier -> ignore
                    }

                    return tierVal >= targetTier;
                }).length;

                if (currentUsage >= (features.maxGuilds || 1)) {
                    res.writeHead(403, { "Content-Type": "application/json" });
                    return res.end(
                        JSON.stringify({
                            ok: false,
                            error: `Limit reached. Your plan allows up to ${features.maxGuilds} servers.`,
                        })
                    );
                }
            }

            // Calculate Valid Until
            let validUntil = null;

            if (body.days) {
                const d = new Date();
                d.setDate(d.getDate() + parseInt(body.days));
                validUntil = d;
            } else if (body.valid_until) {
                validUntil = new Date(body.valid_until);
            } else {
                // Default rules for Trials
                if (targetTier === TIERS.TRIAL_PRO) {
                    const d = new Date();
                    d.setDate(d.getDate() + 14); // 14 Days
                    validUntil = d;
                } else if (targetTier === TIERS.TRIAL_PRO_PLUS) {
                    const d = new Date();
                    d.setDate(d.getDate() + 7); // 7 Days
                    validUntil = d;
                }
            }

            // Upsert with milestone support
            const currentMilestone =
                body.current_milestone !== undefined ? parseInt(body.current_milestone) : 1;
            const autoUnlock = body.auto_unlock_enabled === true;

            const check = await dbQuery("SELECT guild_id FROM subscriptions WHERE guild_id = $1", [
                body.guild,
            ]);
            if (check.rows.length === 0) {
                await dbQuery(
                    "INSERT INTO subscriptions (guild_id, tier, user_id, valid_until, current_milestone, auto_unlock_enabled) VALUES ($1, $2, $3, $4, $5, $6)",
                    [body.guild, targetTier, body.user_id, validUntil, currentMilestone, autoUnlock]
                );
            } else {
                await dbQuery(
                    "UPDATE subscriptions SET tier = $1, user_id = $2, valid_until = $3, current_milestone = $4, auto_unlock_enabled = $5, updated_at = NOW() WHERE guild_id = $6",
                    [targetTier, body.user_id, validUntil, currentMilestone, autoUnlock, body.guild]
                );
            }

            // Invalidate Cache to ensure immediate reflection
            const { cache } = await import("../core/cache.js");
            cache.clearAll(body.guild);

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        } catch (e) {
            console.error("License Update Error:", e);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "Internal Error" }));
        }
        return;
    }

    // POST /api/timeout/release
    if (pathname === "/api/timeout/release" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.user_id)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(body.guild);
            if (!guild) return resJson({ ok: false, error: "Guild not found" }, 404);

            const member = await guild.members.fetch(body.user_id).catch(() => null);
            if (!member) return resJson({ ok: false, error: "Member not found" }, 404);

            if (member.isCommunicationDisabled()) {
                await member.timeout(null, "Manual release from Web Dashboard");
                return resJson({ ok: true });
            } else {
                return resJson({ ok: false, error: "Member is not timed out" });
            }
        } catch (e) {
            console.error("Timeout Release Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // GET /api/tickets
    if (pathname === "/api/tickets" && method === "GET") {
        const guildId = url.searchParams.get("guild");
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const status = url.searchParams.get("status") || "all";
            let query = "SELECT * FROM tickets WHERE guild_id = $1";
            const params = [guildId];

            if (status !== "all") {
                query += " AND status = $2";
                params.push(status);
            }
            query += " ORDER BY created_at DESC LIMIT 100";

            const result = await dbQuery(query, params);

            // 1. Collect all unique IDs for bulk fetching
            const userIds = new Set(result.rows.map((t) => t.user_id));
            result.rows.forEach((t) => {
                if (t.assigned_to) userIds.add(t.assigned_to);
            });

            const guild = await getSafeGuild(guildId);
            let membersMap = new Map();
            if (guild && userIds.size > 0) {
                // Bulk fetch members
                membersMap = await guild.members
                    .fetch({ user: Array.from(userIds) })
                    .catch(() => new Map());
            }

            const tickets = result.rows.map((t) => {
                const member = membersMap.get(t.user_id);
                const staff = t.assigned_to ? membersMap.get(t.assigned_to) : null;

                const userName = member
                    ? `${member.user.username}#${member.user.discriminator || "0000"}`
                    : t.user_id;
                const staffName = staff ? staff.user.username : t.assigned_to || "未割り当て";

                return { ...t, userName, staffName };
            });

            return resJson({ ok: true, tickets });
        } catch (e) {
            console.error("Fetch Tickets Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // POST /api/tickets/close
    if (pathname === "/api/tickets/close" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.ticket_id)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const resData = await dbQuery(
                "SELECT channel_id FROM tickets WHERE id = $1 AND guild_id = $2",
                [body.ticket_id, body.guild]
            );
            if (resData.rows.length === 0)
                return resJson({ ok: false, error: "Ticket not found" }, 404);

            const channelId = resData.rows[0].channel_id;
            const guild = await getSafeGuild(body.guild);
            const channel = guild?.channels.cache.get(channelId);

            // 1. Generate Transcript (v2.8.3)
            let transcriptId = null;
            if (channel) {
                try {
                    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => []);
                    const transcriptData = Array.from(messages.values())
                        .reverse()
                        .map((m) => {
                            return `<div style="margin-bottom:15px; border-bottom:1px solid #333; padding-bottom:10px;">
                            <strong style="color:#5865F2">${m.author.tag}</strong> <small style="color:#72767d">${m.createdAt.toLocaleString()}</small><br>
                            <div style="margin-top:5px;">${m.content.replace(/\n/g, "<br>")}</div>
                            ${m.attachments.size > 0 ? `<div style="color:#1da1f2; font-size:0.8em;">[Attachment: ${m.attachments.first().url}]</div>` : ""}
                        </div>`;
                        })
                        .join("");

                    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Ticket Transcript</title>
                        <style>body{background:#36393f; color:#dcddde; font-family:sans-serif; padding:20px; line-height:1.5;} strong{color:#fff;}</style>
                        </head><body>
                        <h2>Transcript: #${channel.name}</h2>
                        ${transcriptData}
                        </body></html>`;

                    transcriptId = `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                    const dir = path.join(process.cwd(), "public", "transcripts");
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, `${transcriptId}.html`), html);
                } catch (e) {
                    console.error("[TRANSCRIPT ERROR]", e);
                }
            }

            // Update DB
            await dbQuery(
                "UPDATE tickets SET status = 'closed', closed_at = NOW(), transcript_id = $1 WHERE id = $2",
                [transcriptId, body.ticket_id]
            );

            // Try to close/delete channel in Discord if it exists
            if (channel) {
                await channel.send(
                    "🔒 このチケットはウェブダッシュボードから解決済みとしてマークされました。過去ログが保存されました。チャンネルを削除します..."
                );
                setTimeout(() => channel.delete().catch(() => {}), 5000);
            }

            return resJson({ ok: true });
        } catch (e) {
            console.error("Close Ticket Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // POST /api/tickets/assign
    if (pathname === "/api/tickets/assign" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.ticket_id || !body.user_id)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Update DB
            await dbQuery("UPDATE tickets SET assigned_to = $1 WHERE id = $2 AND guild_id = $3", [
                body.user_id,
                body.ticket_id,
                body.guild,
            ]);

            // Notify in Discord channel if possible
            const resData = await dbQuery(
                "SELECT channel_id FROM tickets WHERE id = $1 AND guild_id = $2",
                [body.ticket_id, body.guild]
            );
            if (resData.rows.length > 0) {
                const guild = await getSafeGuild(body.guild);
                const channel = guild?.channels.cache.get(resData.rows[0].channel_id);
                if (channel) {
                    await channel.send(
                        `👥 担当者が変更されました: <@${body.user_id}> がこのチケットを担当します。`
                    );
                }
            }

            return resJson({ ok: true });
        } catch (e) {
            console.error("Assign Ticket Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // POST /api/tickets/delete (v2.5.0)
    if (pathname === "/api/tickets/delete" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.ticket_id)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // 1. Get transcript ID for file deletion
            const resData = await dbQuery(
                "SELECT transcript_id FROM tickets WHERE id = $1 AND guild_id = $2",
                [body.ticket_id, body.guild]
            );
            if (resData.rows.length === 0)
                return resJson({ ok: false, error: "Ticket not found" }, 404);

            const transcriptId = resData.rows[0].transcript_id;

            // 2. Delete Transcript File if exists
            if (transcriptId) {
                const transcriptPath = path.join(
                    process.cwd(),
                    "public",
                    "transcripts",
                    `${transcriptId}.html`
                );
                if (fs.existsSync(transcriptPath)) {
                    fs.unlinkSync(transcriptPath);
                    console.log(`[TICKET] Deleted transcript file: ${transcriptPath}`);
                }
            }

            // 3. Delete from DB
            await dbQuery("DELETE FROM tickets WHERE id = $1 AND guild_id = $2", [
                body.ticket_id,
                body.guild,
            ]);

            return resJson({ ok: true });
        } catch (e) {
            console.error("Delete Ticket Error:", e);
            return resJson({ ok: false, error: "Internal Error" }, 500);
        }
    }

    // GET /api/button-roles
    if (pathname === "/api/button-roles" && method === "GET") {
        const guildId = url.searchParams.get("guild");
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        const resDb = await dbQuery(
            "SELECT * FROM button_roles WHERE guild_id = $1 ORDER BY created_at DESC",
            [guildId]
        );
        return resJson({ ok: true, data: resDb.rows });
    }

    // POST /api/button-roles
    if (pathname === "/api/button-roles" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.channel_id || !body.buttons)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(body.guild);
            const channel =
                guild?.channels.cache.get(body.channel_id) ||
                (await guild?.channels.fetch(body.channel_id).catch(() => null));
            if (!channel) return resJson({ ok: false, error: "Channel not found" }, 404);

            const embedContent = body.content || "役職を選択してください。";
            const embedTitle = body.embed_title || "役職パネル";
            const embedColorNum = parseInt((body.color || "#5865F2").replace("#", ""), 16);

            const embed = new EmbedBuilder()
                .setTitle(embedTitle)
                .setDescription(embedContent)
                .setColor(embedColorNum);

            const row = new ActionRowBuilder();
            body.buttons.forEach((btn) => {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`btn_role_${btn.role_id}`)
                        .setLabel(btn.label || "Role")
                        .setStyle(ButtonStyle.Primary)
                );
            });

            const components = row.components.length > 0 ? [row] : [];
            let messageId = body.message_id;
            let message;

            if (messageId) {
                message = await channel.messages.fetch(messageId).catch(() => null);
            }

            if (message) {
                await message.edit({ embeds: [embed], components });
            } else {
                const sent = await channel.send({ embeds: [embed], components });
                messageId = sent.id;
            }

            // Upsert DB
            if (body.id) {
                await dbQuery(
                    "UPDATE button_roles SET channel_id = $1, message_id = $2, content = $3, embed_title = $4, color = $5, buttons = $6, updated_at = NOW() WHERE id = $7 AND guild_id = $8",
                    [
                        body.channel_id,
                        messageId,
                        body.content,
                        body.embed_title,
                        body.color,
                        JSON.stringify(body.buttons),
                        body.id,
                        body.guild,
                    ]
                );
            } else {
                await dbQuery(
                    "INSERT INTO button_roles (guild_id, channel_id, message_id, content, embed_title, color, buttons) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                    [
                        body.guild,
                        body.channel_id,
                        messageId,
                        body.content,
                        body.embed_title,
                        body.color,
                        JSON.stringify(body.buttons),
                    ]
                );
            }

            return resJson({ ok: true });
        } catch (e) {
            console.error("Button Role Save Error:", e);
            return resJson({ ok: false, error: e.message }, 500);
        }
    }

    // DELETE /api/button-roles
    if (pathname === "/api/button-roles" && method === "DELETE") {
        const body = await getBody();
        if (!body.guild || !body.id) return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        await dbQuery("DELETE FROM button_roles WHERE id = $1 AND guild_id = $2", [
            body.id,
            body.guild,
        ]);
        return resJson({ ok: true });
    }

    // GET /api/realtime-stats (B-6: Real-time Dashboard Panel)
    if (pathname === "/api/realtime-stats") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = await getSafeGuild(guildId);

            // Online member count from Discord cache
            let onlineCount = 0;
            if (guild) {
                try {
                    const members = guild.members.cache;
                    onlineCount = members.filter(
                        (m) => m.presence?.status && m.presence.status !== "offline" && !m.user.bot
                    ).size;
                } catch (_) {}
            }

            // Today's VC unique users (JOIN events today)
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [todayVcRes, todayJoinRes, weekNgRes, weekTimeoutRes, activeVcRes] =
                await Promise.all([
                    dbQuery(
                        "SELECT COUNT(DISTINCT user_id) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time >= $2",
                        [guildId, todayStart]
                    ),
                    dbQuery(
                        "SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'join' AND created_at >= $2",
                        [guildId, todayStart]
                    ),
                    dbQuery(
                        "SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at >= NOW() - INTERVAL '7 days'",
                        [guildId]
                    ),
                    dbQuery(
                        "SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'timeout' AND created_at >= NOW() - INTERVAL '7 days'",
                        [guildId]
                    ),
                    dbQuery(
                        "SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND leave_time IS NULL AND join_time >= NOW() - INTERVAL '12 hours'",
                        [guildId]
                    ),
                ]);

            resJson({
                ok: true,
                realtime: {
                    online_count: onlineCount,
                    today_vc_users: parseInt(todayVcRes.rows[0]?.cnt || 0),
                    today_joins: parseInt(todayJoinRes.rows[0]?.cnt || 0),
                    week_ng: parseInt(weekNgRes.rows[0]?.cnt || 0),
                    week_timeouts: parseInt(weekTimeoutRes.rows[0]?.cnt || 0),
                    active_vc_sessions: parseInt(activeVcRes.rows[0]?.cnt || 0),
                    fetched_at: new Date().toISOString(),
                },
            });
        } catch (e) {
            console.error("[API] /api/realtime-stats error:", e.message);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // ===== B-10: チケットカテゴリAPI =====

    // GET /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "GET") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);
        const r = await dbQuery("SELECT * FROM ticket_categories WHERE guild_id=$1 ORDER BY id", [
            guildId,
        ]);
        return resJson({ ok: true, categories: r.rows });
    }

    // POST /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.name) return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);
        await dbQuery(
            "INSERT INTO ticket_categories (guild_id, name, emoji, description) VALUES ($1, $2, $3, $4)",
            [body.guild, body.name, body.emoji || "🎫", body.description || ""]
        );
        return resJson({ ok: true });
    }

    // DELETE /api/ticket-categories
    if (pathname === "/api/ticket-categories" && method === "DELETE") {
        const body = await getBody();
        if (!body.guild || !body.id) return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);
        await dbQuery("DELETE FROM ticket_categories WHERE id=$1 AND guild_id=$2", [
            body.id,
            body.guild,
        ]);
        return resJson({ ok: true });
    }

    // ===== /B-10 =====

    // ===== B-9: 警告管理API =====

    // GET /api/warnings?guild=&user=
    if (pathname === "/api/warnings" && method === "GET") {
        const userId = url.searchParams.get("user");
        if (!guildId) return resJson({ ok: false, error: "Missing guild" }, 400);
        if (!(await verifyGuild(guildId))) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            let query = "SELECT * FROM warnings WHERE guild_id = $1";
            const params = [guildId];
            if (userId) {
                query += " AND user_id = $2 ORDER BY created_at DESC";
                params.push(userId);
            } else query += " ORDER BY created_at DESC LIMIT 200";

            const res2 = await dbQuery(query, params);
            return resJson({ ok: true, warnings: res2.rows });
        } catch (e) {
            return resJson({ ok: false, error: e.message }, 500);
        }
    }

    // POST /api/warnings — 警告発行
    if (pathname === "/api/warnings" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.user_id || !body.reason)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const issuedBy = session.user?.username || "Web Dashboard";
            await dbQuery(
                "INSERT INTO warnings (guild_id, user_id, reason, issued_by) VALUES ($1, $2, $3, $4)",
                [body.guild, body.user_id, body.reason, issuedBy]
            );

            const countRes = await dbQuery(
                "SELECT COUNT(*) as cnt FROM warnings WHERE guild_id=$1 AND user_id=$2",
                [body.guild, body.user_id]
            );
            const totalWarnings = parseInt(countRes.rows[0]?.cnt || 0);

            // 自動アクション（閾値超過時）
            const setRes = await dbQuery(
                "SELECT auto_action_on_warns, warn_action_threshold, warn_action, timeout_minutes FROM settings WHERE guild_id=$1",
                [body.guild]
            );
            const s = setRes.rows[0] || {};
            if (s.auto_action_on_warns && totalWarnings >= (s.warn_action_threshold || 3)) {
                const guild = await getSafeGuild(body.guild);
                if (guild) {
                    const member = await guild.members.fetch(body.user_id).catch(() => null);
                    if (member) {
                        const action = s.warn_action || "timeout";
                        if (action === "timeout") {
                            const mins = s.timeout_minutes || 10;
                            await member
                                .timeout(
                                    mins * 60 * 1000,
                                    `警告${totalWarnings}回達成 (自動アクション)`
                                )
                                .catch(() => {});
                        } else if (action === "kick") {
                            await member
                                .kick(`警告${totalWarnings}回達成 (自動アクション)`)
                                .catch(() => {});
                        } else if (action === "ban") {
                            await member
                                .ban({ reason: `警告${totalWarnings}回達成 (自動アクション)` })
                                .catch(() => {});
                        }
                    }
                }
            }

            return resJson({ ok: true, totalWarnings });
        } catch (e) {
            console.error("[API] POST /api/warnings error:", e.message);
            return resJson({ ok: false, error: e.message }, 500);
        }
    }

    // DELETE /api/warnings — 全リセットまたは個別削除
    if (pathname === "/api/warnings" && method === "DELETE") {
        const body = await getBody();
        if (!body.guild || !body.user_id)
            return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!(await verifyGuild(body.guild)))
            return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            if (body.id) {
                await dbQuery("DELETE FROM warnings WHERE id=$1 AND guild_id=$2", [
                    body.id,
                    body.guild,
                ]);
            } else {
                await dbQuery("DELETE FROM warnings WHERE guild_id=$1 AND user_id=$2", [
                    body.guild,
                    body.user_id,
                ]);
            }
            return resJson({ ok: true });
        } catch (e) {
            return resJson({ ok: false, error: e.message }, 500);
        }
    }

    // ===== /B-9 =====

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not Found" }));
}
