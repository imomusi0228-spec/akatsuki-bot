import { dbQuery } from "../core/db.js";
import { getSession, discordApi } from "../middleware/auth.js";
import { PermissionFlagsBits } from "discord.js";
import { client } from "../core/client.js";
import { TIERS, getFeatures, TIER_NAMES } from "../core/tiers.js";
import { getTier, getSubscriptionInfo } from "../core/subscription.js";
import { runAnnouncerCheck } from "../services/announcer.js";
import { ENV } from "../config/env.js";

function hasManageGuild(permissions, owner = false) {
    if (owner === true) return true;
    const MANAGE_GUILD = 0x20n;
    const ADMINISTRATOR = 0x8n;
    const p = BigInt(permissions || "0");
    return (p & MANAGE_GUILD) === MANAGE_GUILD || (p & ADMINISTRATOR) === ADMINISTRATOR;
}

const memberCache = new Map();
const introCache = new Map();

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

    // Response Helpers
    const resJson = (data, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
    };

    const getBody = async () => {
        return new Promise((resolve) => {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", () => {
                try { resolve(JSON.parse(body)); } catch { resolve({}); }
            });
        });
    };

    // GET /api/guilds
    if (pathname === "/api/guilds") {
        try {
            const userGuilds = await discordApi(session.accessToken, "/users/@me/guilds");
            if (!Array.isArray(userGuilds)) throw new Error("Failed to fetch guilds from Discord");

            const availableGuilds = userGuilds
                .filter(g => hasManageGuild(g.permissions, g.owner))
                .filter(g => client.guilds.cache.has(g.id))
                .map(g => ({ id: g.id, name: g.name, icon: g.icon }));

            // Save to session to speed up subsequent permission checks
            session.guilds = userGuilds;

            resJson({ ok: true, guilds: availableGuilds });
        } catch (e) {
            console.error(`[API ERROR] /api/guilds:`, e.message);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // Helper: Verify guild ownership and permissions
    const verifyGuild = async (guildId) => {
        if (!guildId) return false;

        try {
            // Check if bot is even in the guild
            if (!client.guilds.cache.has(guildId)) return false;

            // Use session cache if available to avoid redundant API calls and potential rate limits
            if (!session.guilds) {
                const userGuilds = await discordApi(session.accessToken, "/users/@me/guilds");
                if (Array.isArray(userGuilds)) {
                    session.guilds = userGuilds;
                } else {
                    console.error(`[AUTH ERROR] Failed to fetch guilds for user ${session.user.id}`);
                    return false;
                }
            }

            const targetGuild = session.guilds.find(g => g.id === guildId);
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
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Stats summary logic (Last 30 days is fine for general summary)
            const [vcRes, tier, subRes, ngCountRes, ngTopRes, leaveRes, timeoutRes] = await Promise.all([
                dbQuery("SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time > NOW() - INTERVAL '30 days'", [guildId]),
                getTier(guildId),
                dbQuery("SELECT valid_until FROM subscriptions WHERE guild_id = $1", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '30 days'", [guildId]),
                dbQuery("SELECT user_id, COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 GROUP BY user_id ORDER BY cnt DESC LIMIT 5", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'leave' AND created_at > NOW() - INTERVAL '30 days'", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'timeout' AND created_at > NOW() - INTERVAL '30 days'", [guildId])
            ]);

            const subData = { tier, valid_until: subRes.rows[0]?.valid_until || null };
            const features = getFeatures(subData.tier);

            // Get guild for member fetching
            const guild = client.guilds.cache.get(guildId);

            // Enrich with Discord Data
            const topUsers = await Promise.all(ngTopRes.rows.map(async (row) => {
                let user = client.users.cache.get(row.user_id);
                if (!user) {
                    try {
                        user = await Promise.race([
                            client.users.fetch(row.user_id),
                            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 500))
                        ]);
                    } catch (e) { }
                }
                // Fetch member to check timeout status
                let member = null;
                if (guild) {
                    try {
                        member = await guild.members.fetch(row.user_id).catch(() => null);
                    } catch (e) { }
                }

                return {
                    user_id: row.user_id,
                    display_name: user ? (user.globalName || user.username) : "Unknown User",
                    avatar_url: user ? user.displayAvatarURL({ size: 64 }) : null,
                    cnt: row.cnt,
                    is_timed_out: member && member.communicationDisabledUntil && member.communicationDisabledUntil > new Date()
                };
            }));

            resJson({
                ok: true,
                subscription: { tier: subData.tier, name: TIER_NAMES[subData.tier], features, valid_until: subData.valid_until },
                stats: {
                    summary: {
                        joins: vcRes.rows[0]?.cnt || 0,
                        leaves: leaveRes.rows[0]?.cnt || 0,
                        timeouts: timeoutRes.rows[0]?.cnt || 0,
                        ngDetected: parseInt(ngCountRes.rows[0]?.cnt || 0)
                    },
                    topNgUsers: topUsers
                }
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
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Month Logic: Default to current month if not specified
            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            // Aggregate total VC minutes per hour of day
            const heatmapRes = await dbQuery(`
                SELECT 
                    EXTRACT(HOUR FROM join_time) as hour_of_day,
                    SUM(COALESCE(duration_seconds, EXTRACT(EPOCH FROM (NOW() - join_time)))) / 60 as total_minutes
                FROM vc_sessions
                WHERE guild_id = $1 
                  AND join_time >= $2 AND join_time <= $3
                GROUP BY hour_of_day
                ORDER BY hour_of_day
            `, [guildId, startOfMonth, endOfMonth]);

            const heatmap = Array(24).fill(0);
            heatmapRes.rows.forEach(r => {
                heatmap[parseInt(r.hour_of_day)] = Math.round(parseFloat(r.total_minutes));
            });

            resJson({ ok: true, heatmap });
        } catch (e) {
            console.error("Heatmap Error:", e);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // GET /api/stats/growth (Pro/Pro+)
    if (pathname === "/api/stats/growth") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);

        const tier = await getTier(guildId);
        const features = getFeatures(tier);
        if (!features.dashboard) {
            return resJson({ ok: false, error: "Pro tier required" }, 403);
        }

        try {
            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            // Member join/leave trends per day
            const growthRes = await dbQuery(`
                SELECT 
                    DATE(created_at) as date,
                    event_type,
                    COUNT(*) as count
                FROM member_events
                WHERE guild_id = $1 
                  AND created_at >= $2 AND created_at <= $3
                GROUP BY date, event_type
                ORDER BY date
            `, [guildId, startOfMonth, endOfMonth]);

            resJson({ ok: true, events: growthRes.rows });
        } catch (e) {
            console.error("Growth Stats Error:", e);
            resJson({ ok: false, error: e.message }, 500);
        }
        return;
    }

    // GET /api/ngwords
    if (pathname === "/api/ngwords") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, words: resDb.rows }));
        return;
    }

    // POST /api/ngwords/add
    if (pathname === "/api/ngwords/add" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.word) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(body.guild)) return resJson({ ok: false, error: "Forbidden" }, 403);

        const rawWords = body.word.split(/\s+/).filter(w => w.trim().length > 0);
        if (rawWords.length === 0) return res.end(JSON.stringify({ ok: false }));

        const tier = await getTier(body.guild);
        const features = getFeatures(tier);

        // Get existing words to filter duplicates
        const existingRes = await dbQuery("SELECT word FROM ng_words WHERE guild_id = $1", [body.guild]);
        const existingSet = new Set(existingRes.rows.map(r => r.word));

        // Filter valid new words
        const uniqueNewWords = [...new Set(rawWords.filter(w => !existingSet.has(w)))];

        if (uniqueNewWords.length === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: true, message: "No new words to add" }));
        }

        if (existingSet.size + uniqueNewWords.length > features.maxNgWords) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: `Limit exceeded. Can't add ${uniqueNewWords.length} words (Max ${features.maxNgWords}).` }));
        }

        for (const w of uniqueNewWords) {
            const isRegex = w.startsWith("/") && w.endsWith("/");
            await dbQuery("INSERT INTO ng_words (guild_id, word, kind, created_by) VALUES ($1, $2, $3, 'Web')",
                [body.guild, w, isRegex ? "regex" : "exact"]);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // POST /api/ngwords/remove
    if (pathname === "/api/ngwords/remove" && method === "POST") {
        const body = await getBody();
        if (!body.guild || !body.word) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(body.guild)) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Automatic Timeout Release Logic
            const tier = await getTier(body.guild);
            const features = getFeatures(tier);

            if (features.autoRelease) {
                // 1. Find users who were logged for this specific word
                const logRes = await dbQuery("SELECT DISTINCT user_id FROM ng_logs WHERE guild_id = $1 AND word = $2", [body.guild, body.word]);
                const userIds = logRes.rows.map(r => r.user_id);

                if (userIds.length > 0) {
                    const guild = client.guilds.cache.get(body.guild);
                    if (guild) {
                        // Process concurrently but catch errors individually
                        await Promise.all(userIds.map(async (userId) => {
                            try {
                                const member = await guild.members.fetch(userId).catch(() => null);
                                if (member && member.isCommunicationDisabled()) {
                                    await member.timeout(null, `NG Word "${body.word}" deleted by admin`);
                                    console.log(`[Auto-Release] Removed timeout for ${member.user.tag} in ${guild.name}`);
                                }
                            } catch (e) {
                                console.error(`[Auto-Release] Failed for user ${userId}:`, e.message);
                            }
                        }));
                    }
                }
            } else {
                console.log(`[Auto-Release] Skipped for guild ${body.guild} (Tier: ${tier}) - Feature disabled for this tier`);
            }

            await dbQuery("DELETE FROM ng_words WHERE guild_id = $1 AND word = $2", [body.guild, body.word]);
            // Also delete logs for this word (User request: History should not remain)
            await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1 AND word = $2", [body.guild, body.word]);

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
        if (!await verifyGuild(body.guild)) return resJson({ ok: false, error: "Forbidden" }, 403);

        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1", [body.guild]);
        await dbQuery("DELETE FROM ng_logs WHERE guild_id = $1", [body.guild]);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // GET /api/settings
    if (pathname === "/api/settings") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);
        const resDb = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guildId]);
        const subInfo = await getSubscriptionInfo(guildId);

        const settings = resDb.rows[0] || {};
        // Ensure alpha_features is always an array
        if (!settings.alpha_features) settings.alpha_features = [];

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            ok: true,
            settings: settings,
            subscription: subInfo
        }));
        return;
    }

    // GET /api/channels
    if (pathname === "/api/channels") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        const channels = guild.channels.cache
            .filter(c => c.isTextBased())
            .map(c => ({ id: c.id, name: c.name }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, channels }));
        return;
    }

    // GET /api/roles
    if (pathname === "/api/roles") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        const roles = guild.roles.cache
            .filter(r => r.name !== "@everyone" && !r.managed)
            .map(r => ({ id: r.id, name: r.name }));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, roles }));
        return;
    }

    // POST /api/settings/update (Improved)
    if (pathname === "/api/settings/update" && method === "POST") {
        const body = await getBody();
        if (!body.guild) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(body.guild)) return resJson({ ok: false, error: "Forbidden" }, 403);

        // Upsert
        const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [body.guild]);
        if (check.rows.length === 0) {
            await dbQuery(`INSERT INTO settings 
                (guild_id, log_channel_id, ng_log_channel_id, audit_role_id, intro_channel_id, ng_threshold, timeout_minutes, 
                 antiraid_enabled, antiraid_threshold, self_intro_enabled, self_intro_role_id, self_intro_min_length,
                 vc_report_enabled, vc_report_channel_id, vc_report_interval, vc_role_rules,
                 antiraid_guard_level, raid_join_threshold, newcomer_restrict_mins, newcomer_min_account_age,
                 link_block_enabled, domain_blacklist, quarantine_role_id, quarantine_channel_id) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
                [body.guild, body.log_channel_id, body.ng_log_channel_id, body.audit_role_id, body.intro_channel_id, body.ng_threshold, body.timeout_minutes,
                body.antiraid_enabled, body.antiraid_threshold, body.self_intro_enabled, body.self_intro_role_id, body.self_intro_min_length,
                body.vc_report_enabled, body.vc_report_channel_id, body.vc_report_interval, JSON.stringify(body.vc_role_rules),
                body.antiraid_guard_level || 0, body.raid_join_threshold || 10, body.newcomer_restrict_mins || 10, body.newcomer_min_account_age || 1,
                body.link_block_enabled || false, JSON.stringify(body.domain_blacklist || []), body.quarantine_role_id || null, body.quarantine_channel_id || null]);
        } else {
            await dbQuery(`UPDATE settings SET 
                log_channel_id = $1, 
                ng_log_channel_id = $2,
                audit_role_id = $3, 
                intro_channel_id = $4, 
                ng_threshold = $5, 
                timeout_minutes = $6,
                antiraid_enabled = $7,
                antiraid_threshold = $8,
                self_intro_enabled = $9,
                self_intro_role_id = $10,
                self_intro_min_length = $11,
                vc_report_enabled = $12,
                vc_report_channel_id = $13,
                vc_report_interval = $14,
                vc_role_rules = $15,
                antiraid_guard_level = $16,
                raid_join_threshold = $17,
                newcomer_restrict_mins = $18,
                newcomer_min_account_age = $19,
                link_block_enabled = $20,
                domain_blacklist = $21,
                quarantine_role_id = $22,
                quarantine_channel_id = $23,
                updated_at = NOW()
                WHERE guild_id = $24`,
                [body.log_channel_id, body.ng_log_channel_id, body.audit_role_id, body.intro_channel_id, body.ng_threshold, body.timeout_minutes,
                body.antiraid_enabled, body.antiraid_threshold, body.self_intro_enabled, body.self_intro_role_id, body.self_intro_min_length,
                body.vc_report_enabled, body.vc_report_channel_id, body.vc_report_interval, JSON.stringify(body.vc_role_rules),
                body.antiraid_guard_level || 0, body.raid_join_threshold || 10, body.newcomer_restrict_mins || 10, body.newcomer_min_account_age || 1,
                body.link_block_enabled || false, JSON.stringify(body.domain_blacklist || []), body.quarantine_role_id || null, body.quarantine_channel_id || null,
                body.guild]);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // GET /api/activity
    if (pathname === "/api/activity") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);

        // Check Tier
        const tier = await getTier(guildId);
        const features = getFeatures(tier);

        if (!features.audit) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "Upgrade to Pro+ required for Activity Audit." }));
        }

        // Inactivity Logic: Users who haven't joined VC or sent message (we don't track msg time in DB)
        // Only have VC tracking.
        // Let's return Mock data or VC data?
        // Real implementation: Fetch guild members, check `joinedAt` and compare with simple threshold.
        // Use discord.js cache to find members.

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        // 1. Get Audit Settings (Allow overrides from query)
        const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guildId]);
        const dbSettings = settingsRes.rows[0] || {};
        const settings = {
            audit_role_id: url.searchParams.get("audit_role_id") || dbSettings.audit_role_id,
            intro_channel_id: url.searchParams.get("intro_channel_id") || dbSettings.intro_channel_id
        };

        const vcWeeks = parseInt(url.searchParams.get("vc_weeks")) || 0;

        // 2. Fetch VC Activity from DB for ALL members in one go
        const vcActivityMap = {};
        const vcRes = await dbQuery("SELECT user_id, MAX(COALESCE(leave_time, join_time)) as last_vc FROM vc_sessions WHERE guild_id = $1 GROUP BY user_id", [guildId]);
        vcRes.rows.forEach(r => { vcActivityMap[r.user_id] = r.last_vc; });

        const introSet = new Set();
        // 3. Scan Intro Channel (Last 100 messages) to find who introduced
        const introCacheKey = `intro_${settings.intro_channel_id}`;
        const cachedIntro = introCache.get(introCacheKey);
        if (cachedIntro && Date.now() - cachedIntro.ts < 30 * 60 * 1000) { // 30 min cache
            cachedIntro.data.forEach(id => introSet.add(id));
        } else if (settings.intro_channel_id) {
            try {
                const channel = client.channels.cache.get(settings.intro_channel_id) || await guild.channels.fetch(settings.intro_channel_id).catch(() => null);
                if (channel && channel.isTextBased()) {
                    let lastId = null;
                    let fetchCount = 0;
                    // Full scan: Fetch up to 1000 messages
                    while (fetchCount < 1000) {
                        const msgs = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
                        if (!msgs || msgs.size === 0) break;
                        msgs.forEach(msg => introSet.add(msg.author.id));
                        lastId = msgs.last().id;
                        fetchCount += msgs.size;
                        if (msgs.size < 100) break;
                    }
                    introCache.set(introCacheKey, { ts: Date.now(), data: Array.from(introSet) });
                }
            } catch (e) { console.error("Intro Scan Error:", e); }
        }
        const auditResults = [];
        try {
            let members;
            const cacheKey = `members_${guildId}`;
            const cached = memberCache.get(cacheKey);
            const refresh = url.searchParams.get("refresh") === "1";

            if (!refresh && cached && Date.now() - cached.ts < 15 * 60 * 1000) { // Increased to 15 min
                members = cached.data;
            } else {
                try {
                    members = await guild.members.fetch();
                    memberCache.set(cacheKey, { ts: Date.now(), data: members });
                } catch (fetchErr) {
                    // Check if we have cached data even if it's old (Stale-while-error)
                    if (cached && (fetchErr.name === 'GatewayRateLimitError' || fetchErr.code === 50035 || String(fetchErr).includes('rate limited'))) {
                        console.warn(`[Activity Scan] Rate limited, using stale cache for guild ${guildId}`);
                        members = cached.data;
                    } else if (fetchErr.name === 'GatewayRateLimitError' || fetchErr.code === 50035 || String(fetchErr).includes('rate limited')) {
                        const retryAfter = fetchErr.data?.retry_after || 5;
                        console.warn(`[Activity Scan] Rate limited! Retry after ${retryAfter}s. Guild: ${guildId}`);
                        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": retryAfter });
                        return res.end(JSON.stringify({ ok: false, error: "Rate limited by Discord. Please try again in a few seconds.", retry_after: retryAfter }));
                    } else {
                        throw fetchErr;
                    }
                }
            }

            members.forEach(m => {
                if (m.user.bot) return;

                const inVcNow = m.voice?.channelId;
                let lastVcDate = vcActivityMap[m.id];

                // If currently in VC, treat as NOW (overrides DB null)
                if (inVcNow) lastVcDate = new Date();

                const hasRole = settings.audit_role_id ? m.roles.cache.has(settings.audit_role_id) : true;
                const hasIntro = settings.intro_channel_id ? introSet.has(m.user.id) : true;

                // VC Threshold Check
                let vcOk = !!(lastVcDate || inVcNow);
                if (vcWeeks > 0 && lastVcDate) {
                    const thresholdDate = new Date();
                    thresholdDate.setDate(thresholdDate.getDate() - (vcWeeks * 7));
                    if (new Date(lastVcDate) < thresholdDate) vcOk = false;
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
                    last_vc: fmtDate(lastVcDate),
                    joined_at: m.joinedAt ? m.joinedAt.toISOString().split("T")[0] : "Unknown",
                    status: status
                });
            });
        } catch (e) { console.error("Activity Scan Error:", e); }


        const sub = await getSubscriptionInfo(guildId);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            ok: true,
            subscription: sub,
            data: auditResults.sort((a, b) => (a.status === "NG" ? -1 : 1)) // NG first
        }));
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
                const usageRes = await dbQuery("SELECT tier, guild_id FROM subscriptions WHERE user_id = $1", [body.user_id]);

                const currentUsage = usageRes.rows.filter(r => {
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
                    return res.end(JSON.stringify({ ok: false, error: `Limit reached. Your plan allows up to ${features.maxGuilds} servers.` }));
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
            const currentMilestone = body.current_milestone !== undefined ? parseInt(body.current_milestone) : 1;
            const autoUnlock = body.auto_unlock_enabled === true;

            const check = await dbQuery("SELECT guild_id FROM subscriptions WHERE guild_id = $1", [body.guild]);
            if (check.rows.length === 0) {
                await dbQuery("INSERT INTO subscriptions (guild_id, tier, user_id, valid_until, current_milestone, auto_unlock_enabled) VALUES ($1, $2, $3, $4, $5, $6)",
                    [body.guild, targetTier, body.user_id, validUntil, currentMilestone, autoUnlock]);
            } else {
                await dbQuery("UPDATE subscriptions SET tier = $1, user_id = $2, valid_until = $3, current_milestone = $4, auto_unlock_enabled = $5, updated_at = NOW() WHERE guild_id = $6",
                    [targetTier, body.user_id, validUntil, currentMilestone, autoUnlock, body.guild]);
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
        if (!body.guild || !body.user_id) return resJson({ ok: false, error: "Missing fields" }, 400);
        if (!await verifyGuild(body.guild)) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            const guild = client.guilds.cache.get(body.guild);
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

    // POST /api/updates/receive
    if (pathname === "/api/updates/receive" && method === "POST") {
        const body = await getBody();
        if (body.token !== ENV.ADMIN_TOKEN) {
            return resJson({ ok: false, error: "Unauthorized" }, 401);
        }

        console.log(`[UPDATE RECEIVE] Received: ${body.title}`);
        // Optionally save to DB or just acknowledge
        return resJson({ ok: true, message: "Update received successfully" });
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not Found" }));
}
