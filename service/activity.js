import { PermissionFlagsBits } from "discord.js";

function getOneWeekAgo(weeks = 1) {
    const d = new Date();
    d.setDate(d.getDate() - (weeks * 7));
    return d.getTime();
}

export async function checkActivityStats(guild, db) {
    // 1. Fetch Settings
    const setting = await db.get("SELECT activity_weeks, intro_channel_id, target_role_id FROM settings WHERE guild_id=$1", guild.id);
    const weeks = setting?.activity_weeks || 4;
    const introChId = setting?.intro_channel_id;
    const targetRoleId = setting?.target_role_id;

    const since = getOneWeekAgo(weeks);

    // 2. Identify Active Users (VC IN / MOVE / Session)
    // Query log_events for any VC activity in range
    const activeRows = await db.all(
        `SELECT DISTINCT user_id FROM log_events 
         WHERE guild_id=$1 
         AND ts >= $2 
         AND type IN ('vc_in', 'vc_move', 'vc_out')`,
        guild.id, since
    );
    const activeUserIds = new Set(activeRows.map(r => r.user_id));

    // Also check currently active sessions (just in case they joined > weeks ago and are STILL in VC, though unlikely without reconnect)
    const sessionRows = await db.all("SELECT user_id FROM vc_sessions WHERE guild_id=$1", guild.id);
    sessionRows.forEach(r => activeUserIds.add(r.user_id));

    // 3. Intro Check (if configured)
    const foundIntroUserIds = new Set();
    if (introChId) {
        try {
            const ch = guild.channels.cache.get(introChId) || await guild.channels.fetch(introChId).catch(() => null);
            if (ch && ch.isTextBased()) {
                // Fetch last 100 messages (limit)
                const msgs = await ch.messages.fetch({ limit: 100 }).catch(() => null);
                if (msgs) {
                    msgs.forEach(m => foundIntroUserIds.add(m.author.id));
                }
            }
        } catch (e) {
            console.error("Intro fetch error:", e);
        }
    }

    // 4. Scan Members
    // Fetch all members. API call might be heavy for large servers, but necessary.
    const members = await guild.members.fetch();
    const inactiveUsers = [];

    // Prepare Last VC Map for inactive users
    // We want "Last VC Date" for everyone? That's heavy.
    // Let's do a single aggregation query for ALL users' last_vc ts, then map it.
    const lastVcRows = await db.all(
        `SELECT user_id, MAX(ts) as last_ts FROM log_events 
         WHERE guild_id=$1 AND type IN ('vc_in','vc_out','vc_move')
         GROUP BY user_id`,
        guild.id
    );
    const lastVcMap = new Map();
    lastVcRows.forEach(r => lastVcMap.set(r.user_id, Number(r.last_ts)));

    for (const [mid, m] of members) {
        if (m.user.bot) continue; // Skip bots
        if (activeUserIds.has(mid)) continue; // Skip active

        // Inactive! Gather info
        const hasRole = targetRoleId ? (m.roles.cache.has(targetRoleId) ? "Yes" : "No") : "-";
        const hasIntro = introChId ? (foundIntroUserIds.has(mid) ? "Yes" : "No (Recent)") : "-";

        const lastTs = lastVcMap.get(mid);
        let lastVcStr = "Never";
        if (lastTs) {
            const d = new Date(lastTs);
            // Format: YYYY-MM-DD
            lastVcStr = d.toISOString().split("T")[0];
        }

        inactiveUsers.push({
            user_id: mid,
            username: m.user.username,
            display_name: m.displayName,
            last_vc: lastVcStr,
            has_role: hasRole,
            has_intro: hasIntro
        });
    }

    return {
        config: { weeks },
        data: inactiveUsers
    };
}
