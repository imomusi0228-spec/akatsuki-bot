import { dbQuery } from "../../core/db.js";
import { getTier, getSubscriptionInfo, getUserTier } from "../../core/subscription.js";
import { getFeatures, TIER_COLORS, TIERS } from "../../core/tiers.js";
import { resJson, verifyGuild, getSafeGuild } from "./helpers.js";
import { client } from "../../core/client.js";

export async function handleStatsRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const monthParam = url.searchParams.get("month"); // YYYY-MM

    const isStatsRoute = pathname.startsWith("/api/stats") || pathname === "/api/realtime-stats";
    if (!isStatsRoute) return false;

    if (!guildId) {
        resJson(res, { ok: false, error: "Missing guild ID" }, 400);
        return true;
    }
    if (!(await verifyGuild(guildId, session))) {
        resJson(res, { ok: false, error: "Forbidden" }, 403);
        return true;
    }

    // GET /api/stats
    if (pathname === "/api/stats") {
        try {
            const [tier, userTier] = await Promise.all([
                getTier(guildId),
                getUserTier(session.user.id),
            ]);

            const features = getFeatures(tier, guildId, userTier);
            const statsDays = features.longTermStats ? 30 : 7;
            const periodInterval = `${statsDays} days`;

            const [vcRes, ngCountRes, ngTopRes, leaveRes, timeoutRes] = await Promise.all([
                dbQuery("SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time > NOW() - $2::INTERVAL", [guildId, periodInterval]),
                dbQuery("SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - $2::INTERVAL", [guildId, periodInterval]),
                dbQuery("SELECT user_id, COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - $2::INTERVAL GROUP BY user_id ORDER BY cnt DESC LIMIT 5", [guildId, periodInterval]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'leave' AND created_at > NOW() - $2::INTERVAL", [guildId, periodInterval]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'timeout' AND created_at > NOW() - $2::INTERVAL", [guildId, periodInterval]),
            ]);

            const topUsers = await Promise.all(
                ngTopRes.rows.map(async (row) => {
                    let user = client.users.cache.get(row.user_id) || await client.users.fetch(row.user_id).catch(() => null);
                    let member = null;
                    const guild = await getSafeGuild(guildId);
                    if (guild) {
                        member = guild.members.cache.get(row.user_id) || await guild.members.fetch(row.user_id).catch(() => null);
                    }
                    return {
                        user_id: row.user_id,
                        display_name: user ? user.globalName || user.username : "Unknown User",
                        avatar_url: user ? user.displayAvatarURL({ size: 64 }) : null,
                        cnt: row.cnt,
                        is_timed_out: member && member.communicationDisabledUntil && member.communicationDisabledUntil > new Date(),
                    };
                })
            );

            const subInfo = await getSubscriptionInfo(guildId, session.user.id);

            return resJson(res, {
                ok: true,
                subscription: subInfo,
                planName: subInfo.name,
                planColor: subInfo.color,
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
        } catch (e) { searchStatsError(res, e); }
    }

    // GET /api/stats/heatmap
    if (pathname === "/api/stats/heatmap") {
        try {
            const [tier, userTier] = await Promise.all([getTier(guildId), getUserTier(session.user.id)]);
            const features = getFeatures(tier, guildId, userTier);
            const statsDays = features.longTermStats ? 30 : 7;

            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonthRaw = new Date(date.getFullYear(), date.getMonth(), 1);
            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - statsDays);
            const startOfMonth = startOfMonthRaw < limitDate ? limitDate : startOfMonthRaw;
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            const [heatmapRes, msgHeatmapRes] = await Promise.all([
                dbQuery(`SELECT EXTRACT(HOUR FROM join_time AT TIME ZONE 'Asia/Tokyo') as hour_of_day, SUM(COALESCE(duration_seconds, EXTRACT(EPOCH FROM (NOW() - join_time)))) / 60 as total_minutes FROM vc_sessions WHERE guild_id = $1 AND join_time >= $2 AND join_time <= $3 GROUP BY hour_of_day`, [guildId, startOfMonth, endOfMonth]),
                dbQuery(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo') as hour_of_day, COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'message' AND created_at >= $2 AND created_at <= $3 GROUP BY hour_of_day`, [guildId, startOfMonth, endOfMonth]),
            ]);

            const heatmap = Array(24).fill(0);
            heatmapRes.rows.forEach((r) => heatmap[parseInt(r.hour_of_day)] = Math.round(parseFloat(r.total_minutes)));
            const msg_heatmap = Array(24).fill(0);
            msgHeatmapRes.rows.forEach((r) => msg_heatmap[parseInt(r.hour_of_day)] = parseInt(r.cnt));

            return resJson(res, { ok: true, heatmap, msg_heatmap, ng_heatmap: msg_heatmap });
        } catch (e) { searchStatsError(res, e); }
    }

    // GET /api/stats/growth
    if (pathname === "/api/stats/growth") {
        try {
            const [tier, userTier] = await Promise.all([getTier(guildId), getUserTier(session.user.id)]);
            const features = getFeatures(tier, guildId, userTier);
            if (!features.dashboard) return resJson(res, { ok: false, error: "Pro tier required" }, 403);

            const statsDays = features.longTermStats ? 30 : 7;
            const date = monthParam ? new Date(monthParam + "-01") : new Date();
            const startOfMonthRaw = new Date(date.getFullYear(), date.getMonth(), 1);
            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - statsDays);
            const startOfMonth = startOfMonthRaw < limitDate ? limitDate : startOfMonthRaw;
            const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59);

            // Optimization: Use daily_stats first for historical data, then member_events for today
            const growthRes = await dbQuery(`
                SELECT stats_date as date, 'join' as event_type, join_count as count FROM daily_stats WHERE guild_id = $1 AND stats_date >= $2 AND stats_date <= $3
                UNION ALL
                SELECT stats_date as date, 'leave' as event_type, leave_count as count FROM daily_stats WHERE guild_id = $1 AND stats_date >= $2 AND stats_date <= $3
                ORDER BY date
            `, [guildId, startOfMonth, endOfMonth]);

            return resJson(res, { ok: true, events: growthRes.rows });
        } catch (e) { searchStatsError(res, e); }
    }

    // GET /api/realtime-stats
    if (pathname === "/api/realtime-stats") {
        try {
            const guild = await getSafeGuild(guildId);
            let onlineCount = 0;
            if (guild) {
                onlineCount = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== "offline" && !m.user.bot).size;
            }

            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);

            const [todayVcRes, todayJoinRes, weekNgRes, weekTimeoutRes, activeVcRes] = await Promise.all([
                dbQuery("SELECT COUNT(DISTINCT user_id) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time >= $2", [guildId, todayStart]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'join' AND created_at >= $2", [guildId, todayStart]),
                dbQuery("SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at >= NOW() - INTERVAL '7 days'", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'timeout' AND created_at >= NOW() - INTERVAL '7 days'", [guildId]),
                dbQuery("SELECT COUNT(*) as cnt FROM vc_sessions WHERE guild_id = $1 AND leave_time IS NULL AND join_time >= NOW() - INTERVAL '12 hours'", [guildId]),
            ]);

            return resJson(res, {
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
        } catch (e) { searchStatsError(res, e); }
    }

    return false; // Not handled here
}

function searchStatsError(res, e) {
    console.error("[API Stats Error]", e.message);
    resJson(res, { ok: false, error: "Internal Server Error" }, 500);
}
