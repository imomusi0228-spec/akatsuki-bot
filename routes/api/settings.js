import { dbQuery } from "../../core/db.js";
import { getSubscriptionInfo } from "../../core/subscription.js";
import { resJson, verifyGuild, getSafeGuild, getBody } from "./helpers.js";

export async function handleSettingsRoutes(req, res, pathname, url, session) {
    const guildId = url.searchParams.get("guild");
    const method = req.method;

    const isSettingsRoute = pathname.startsWith("/api/settings");
    if (!isSettingsRoute) return false;

    if (!guildId && method === "GET") {
        resJson(res, { ok: false, error: "Missing guild ID" }, 400);
        return true;
    }

    // GET /api/settings
    if (pathname === "/api/settings" && method === "GET") {
        if (!(await verifyGuild(guildId, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);
        try {
            const resDb = await dbQuery(`
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
                    ai_predict_channel_id,
                    auto_vc_creator_id, ticket_staff_role_id,
                    ticket_log_channel_id,
                    antiraid_auto_recovery_enabled,
                    antiraid_honeypot_channel_id,
                    antiraid_avatar_scrutiny_enabled,
                    auto_action_on_warns, warn_action_threshold, warn_action,
                    leaderboard_enabled, levelup_enabled, levelup_channel_id,
                    welcome_enabled, welcome_channel_id, welcome_message,
                    farewell_enabled, farewell_channel_id, farewell_message,
                    mod_log_channel_id, mod_log_flags,
                    ticket_panel_title, ticket_panel_desc, antinuke_flags,
                    antinuke_threshold
                FROM settings 
                WHERE guild_id = $1
            `, [guildId]);
            const settings = resDb.rows[0] || {};
            const subInfo = await getSubscriptionInfo(guildId, session.user.id);
            if (!settings.alpha_features) settings.alpha_features = [];

            return resJson(res, { ok: true, settings, subscription: subInfo });
        } catch (e) {
            console.error("[SETTINGS ERROR]", e);
            return resJson(res, { ok: false, error: "Database Error" }, 500);
        }
    }

    // POST /api/settings/update
    if (pathname === "/api/settings/update" && method === "POST") {
        const body = await getBody(req);
        if (!body.guild) return resJson(res, { ok: false, error: "Missing guild" }, 400);
        if (!(await verifyGuild(body.guild, session))) return resJson(res, { ok: false, error: "Forbidden" }, 403);

        try {
            const allowedFields = [
                "log_channel_id", "ng_log_channel_id", "audit_role_id", "intro_channel_id",
                "ng_threshold", "timeout_minutes", "antiraid_enabled", "antiraid_threshold",
                "self_intro_enabled", "self_intro_role_id", "self_intro_min_length",
                "vc_report_enabled", "vc_report_channel_id", "vc_report_interval", "vc_role_rules",
                "antiraid_guard_level", "raid_join_threshold", "newcomer_restrict_mins",
                "newcomer_min_account_age", "link_block_enabled", "domain_blacklist",
                "ai_advice_days", "ai_advice_channel_id", "ai_insight_enabled",
                "ai_insight_channel_id", "insight_sections", "phase2_threshold", "phase2_action",
                "phase3_threshold", "phase3_action", "phase4_threshold", "phase4_action",
                "intro_reminder_hours", "report_channel_id", "ng_warning_enabled", "ticket_welcome_msg",
                "color_log", "color_ng", "color_vc_join", "color_vc_leave", "color_level", "color_ticket",
                "dashboard_theme_color", "dashboard_theme_mode", "ai_prediction_enabled",
                "ai_predict_channel_id", "auto_vc_creator_id", "ticket_staff_role_id",
                "ticket_log_channel_id", "antiraid_auto_recovery_enabled", "antiraid_honeypot_channel_id",
                "antiraid_avatar_scrutiny_enabled", "auto_action_on_warns", "warn_action_threshold",
                "warn_action", "leaderboard_enabled", "levelup_enabled", "levelup_channel_id",
                "welcome_enabled", "welcome_channel_id", "welcome_message", "farewell_enabled",
                "farewell_channel_id", "farewell_message", "mod_log_channel_id", "mod_log_flags",
                "ticket_panel_title", "ticket_panel_desc", "antinuke_flags", "antinuke_threshold"
            ];

            const keys = Object.keys(body).filter((k) => allowedFields.includes(k));
            if (keys.length === 0) return resJson(res, { ok: true });

            const values = keys.map((k) => {
                const val = body[k];
                if (["vc_role_rules", "domain_blacklist", "insight_sections", "mod_log_flags", "antinuke_flags"].includes(k)) {
                    return JSON.stringify(val || {});
                }
                return val;
            });

            const placeholders = keys.map((_, i) => `$${i + 2}`).join(", ");
            const updateSet = keys.map((k) => `${k} = EXCLUDED.${k}`).join(", ");

            await dbQuery(`
                INSERT INTO settings (guild_id, ${keys.join(", ")}, updated_at)
                VALUES ($1, ${placeholders}, NOW())
                ON CONFLICT (guild_id) DO UPDATE SET ${updateSet}, updated_at = NOW();
            `, [body.guild, ...values]);

            return resJson(res, { ok: true });
        } catch (e) {
            console.error("[SETTINGS UPDATE ERROR]", e);
            return resJson(res, { ok: false, error: "Database Error" }, 500);
        }
    }

    return false;
}
