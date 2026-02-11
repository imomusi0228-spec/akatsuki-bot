import { dbQuery } from "../core/db.js";
import { getSession, discordApi } from "../middleware/auth.js";
import { PermissionFlagsBits } from "discord.js";
import { client } from "../core/client.js";
import { TIERS, getFeatures, TIER_NAMES } from "../core/tiers.js";
import { getTier } from "../core/subscription.js";

function hasManageGuild(permissions, owner = false) {
    if (owner === true) return true;
    const MANAGE_GUILD = 0x20n;
    const ADMINISTRATOR = 0x8n;
    const p = BigInt(permissions || "0");
    return (p & MANAGE_GUILD) === MANAGE_GUILD || (p & ADMINISTRATOR) === ADMINISTRATOR;
}

const memberCache = new Map();

export async function handleApiRoute(req, res, pathname, url) {
    const session = await getSession(req);
    if (!session) {
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

    // GET /api/stats
    if (pathname === "/api/stats") {
        if (!guildId) return resJson({ ok: false, error: "Missing guild ID" }, 400);
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);

        try {
            // Fetch necessary data
            const [vcRes, tier, subRes, ngCountRes, ngTopRes] = await Promise.all([
                dbQuery("SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time > NOW() - INTERVAL '30 days'", [guildId]),
                getTier(guildId),
                dbQuery("SELECT valid_until FROM subscriptions WHERE guild_id = $1", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '30 days'", [guildId]),
                dbQuery("SELECT user_id, COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 GROUP BY user_id ORDER BY cnt DESC LIMIT 5", [guildId])
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
                        leaves: 0,
                        timeouts: 0,
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
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, settings: resDb.rows[0] || {} }));
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
                (guild_id, log_channel_id, audit_role_id, intro_channel_id, ng_threshold, timeout_minutes) 
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [body.guild, body.log_channel_id, body.audit_role_id, body.intro_channel_id, body.ng_threshold, body.timeout_minutes]);
        } else {
            await dbQuery(`UPDATE settings SET 
                log_channel_id = $1, 
                audit_role_id = $2, 
                intro_channel_id = $3, 
                ng_threshold = $4, 
                timeout_minutes = $5,
                updated_at = NOW()
                WHERE guild_id = $6`,
                [body.log_channel_id, body.audit_role_id, body.intro_channel_id, body.ng_threshold, body.timeout_minutes, body.guild]);
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

        if (!features.activity) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "Upgrade required for Activity Audit." }));
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

        // 2. Fetch VC Activity from DB for ALL members in one go
        const vcActivityMap = {};
        const vcRes = await dbQuery("SELECT user_id, MAX(COALESCE(leave_time, join_time)) as last_vc FROM vc_sessions WHERE guild_id = $1 GROUP BY user_id", [guildId]);
        vcRes.rows.forEach(r => { vcActivityMap[r.user_id] = r.last_vc; });

        // 3. Scan Intro Channel (Last 100 messages) to find who introduced
        const introSet = new Set();
        if (settings.intro_channel_id) {
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
                }
            } catch (e) { console.error("Intro Scan Error:", e); }
        }
        const auditResults = [];
        try {
            let members;
            const cacheKey = `members_${guildId}`;
            const cached = memberCache.get(cacheKey);
            const refresh = url.searchParams.get("refresh") === "1";

            if (!refresh && cached && Date.now() - cached.ts < 5 * 60 * 1000) {
                members = cached.data;
            } else {
                try {
                    members = await guild.members.fetch();
                    memberCache.set(cacheKey, { ts: Date.now(), data: members });
                } catch (fetchErr) {
                    if (fetchErr.name === 'GatewayRateLimitError' || fetchErr.code === 50035 || String(fetchErr).includes('rate limited')) {
                        const retryAfter = fetchErr.data?.retry_after || 5;
                        console.warn(`[Activity Scan] Rate limited! Retry after ${retryAfter}s. Guild: ${guildId}`);
                        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": retryAfter });
                        return res.end(JSON.stringify({ ok: false, error: "Rate limited by Discord. Please try again in a few seconds.", retry_after: retryAfter }));
                    }
                    throw fetchErr;
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


        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            ok: true,
            data: auditResults.sort((a, b) => (a.status === "NG" ? -1 : 1)) // NG first
        }));
        return;
    }

    // GET /api/activity/export (CSV)
    if (pathname === "/api/activity/export") {
        if (!guildId) return res.end(JSON.stringify({ ok: false }));
        if (!await verifyGuild(guildId)) return resJson({ ok: false, error: "Forbidden" }, 403);
        const tier = await getTier(guildId);
        const features = getFeatures(tier);
        if (!features.activity) {
            res.writeHead(403, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: "Upgrade required" }));
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.end(JSON.stringify({ ok: false, error: "Guild not found" }));

        // 1. Get Audit Settings (Allow overrides via Query Params)
        // Note: We check if param is present (not null) to allow clearing settings (sending empty string)
        const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guildId]);
        const dbSettings = settingsRes.rows[0] || {};

        const qRole = url.searchParams.get("audit_role_id");
        const qIntro = url.searchParams.get("intro_channel_id");

        const settings = {
            audit_role_id: qRole !== null ? qRole : dbSettings.audit_role_id,
            intro_channel_id: qIntro !== null ? qIntro : dbSettings.intro_channel_id
        };

        const vcRes = await dbQuery("SELECT user_id, MAX(COALESCE(leave_time, join_time)) as last_vc FROM vc_sessions WHERE guild_id = $1 GROUP BY user_id", [guildId]);
        const vcMap = {}; vcRes.rows.forEach(r => vcMap[r.user_id] = r.last_vc);

        const introSet = new Set();
        if (settings.intro_channel_id) {
            try {
                const ch = await guild.channels.fetch(settings.intro_channel_id).catch(() => null);
                if (ch?.isTextBased()) {
                    let lastId = null;
                    let count = 0;
                    while (count < 1000) {
                        const msgs = await ch.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
                        if (!msgs || msgs.size === 0) break;
                        msgs.forEach(m => introSet.add(m.author.id));
                        lastId = msgs.last().id;
                        count += msgs.size;
                        if (msgs.size < 100) break;
                    }
                }
            } catch (e) { }
        }

        const filter = url.searchParams.get("filter") || "ng";
        let csv = "\uFEFFUser ID,Display Name,Role Audit,Intro Audit,Last VC,Status\r\n";
        try {
            const members = await guild.members.fetch();
            members.forEach(m => {
                if (m.user.bot) return;

                const inVcNow = m.voice?.channelId;
                let lastVcDate = vcMap[m.id];
                if (inVcNow) lastVcDate = new Date();

                const hasRole = settings.audit_role_id ? m.roles.cache.has(settings.audit_role_id) : true;
                const hasIntro = settings.intro_channel_id ? introSet.has(m.user.id) : true;

                // VC Threshold Check
                let vcOk = !!(lastVcDate || inVcNow);
                const vcWeeks_exp = parseInt(url.searchParams.get("vc_weeks")) || 0;
                if (vcWeeks_exp > 0 && lastVcDate) {
                    const thresholdDate = new Date();
                    thresholdDate.setDate(thresholdDate.getDate() - (vcWeeks_exp * 7));
                    if (new Date(lastVcDate) < thresholdDate) vcOk = false;
                }

                const status = (hasRole && hasIntro && vcOk) ? "OK" : "NG";

                if (filter === "ng" && status === "OK") return;

                const fmtDate = (d) => {
                    if (!d) return "None";
                    const dateObj = d instanceof Date ? d : new Date(d);
                    return isNaN(dateObj.getTime()) ? "None" : dateObj.toISOString().split("T")[0];
                };

                csv += `"${m.id}","${m.displayName.replace(/"/g, '""')}","${hasRole ? "OK" : "NG"}","${hasIntro ? "OK" : "NG"}","${fmtDate(lastVcDate)}","${status}"\r\n`;
            });
        } catch (e) { }

        res.writeHead(200, {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": "attachment; filename=audit_results.csv"
        });
        res.end(csv);
        return;
    }

    // POST /api/license/update (Improved with per-user server limit)
    if (pathname === "/api/license/update" && method === "POST") {
        const body = await getBody();
        if (!body.guild || body.tier === undefined || !body.user_id) {
            return res.end(JSON.stringify({ ok: false, error: "Missing required fields" }));
        }

        const targetTier = parseInt(body.tier);
        const features = getFeatures(targetTier);

        // Check how many servers the user already has at this tier (or higher, for safety)
        // If tier=0 (Free), we don't usually need a limit here, but let's be generic
        if (targetTier > 0) {
            const usageRes = await dbQuery("SELECT COUNT(*) as cnt FROM subscriptions WHERE user_id = $1 AND tier >= $2 AND guild_id != $3", [body.user_id, targetTier, body.guild]);
            const currentUsage = parseInt(usageRes.rows[0].cnt);

            if (currentUsage >= (features.maxGuilds || 1)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ ok: false, error: `Limit reached. Your plan allows up to ${features.maxGuilds} servers.` }));
            }
        }

        // Upsert
        const check = await dbQuery("SELECT guild_id FROM subscriptions WHERE guild_id = $1", [body.guild]);
        if (check.rows.length === 0) {
            await dbQuery("INSERT INTO subscriptions (guild_id, tier, user_id) VALUES ($1, $2, $3)", [body.guild, targetTier, body.user_id]);
        } else {
            await dbQuery("UPDATE subscriptions SET tier = $1, user_id = $2, updated_at = NOW() WHERE guild_id = $3", [targetTier, body.user_id, body.guild]);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
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

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not Found" }));
}
