import pg from "pg";
import { ENV } from "../config/env.js";

const { Pool } = pg;

const poolConfig = {
    connectionString: ENV.DATABASE_URL,
    ssl: ENV.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
};

export const pool = new Pool(poolConfig);

export const dbQuery = (text, params) => pool.query(text, params);

export async function initDb() {
    // Minimal log for production
    console.log(`📡 Initializing Database Connection...`);

    const coreTables = [
        `CREATE TABLE IF NOT EXISTS settings (
            guild_id TEXT PRIMARY KEY,
            log_channel_id TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW(),
            -- ... other columns handled by migrations for safety
            log_channel_name TEXT
        );`,
        `CREATE TABLE IF NOT EXISTS subscriptions (
            guild_id TEXT PRIMARY KEY,
            tier INTEGER DEFAULT 0,
            valid_until TIMESTAMPTZ,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        );`,
        `CREATE TABLE IF NOT EXISTS member_stats (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            total_vc_minutes INTEGER DEFAULT 0,
            last_activity_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (guild_id, user_id)
        );`,
        `CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            data JSONB NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        );`,
    ];

    const featureTables = [
        `CREATE TABLE IF NOT EXISTS ng_words (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, word TEXT NOT NULL, kind TEXT DEFAULT 'exact', created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS vc_sessions (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, join_time TIMESTAMPTZ NOT NULL, leave_time TIMESTAMPTZ, duration_seconds INTEGER);`,
        `CREATE TABLE IF NOT EXISTS ng_logs (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, word TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS warnings (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, issued_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS tickets (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS member_events (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, event_type TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS ticket_categories (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT, description TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS daily_stats (
            guild_id TEXT NOT NULL,
            stats_date DATE NOT NULL,
            message_count INTEGER DEFAULT 0,
            join_count INTEGER DEFAULT 0,
            leave_count INTEGER DEFAULT 0,
            vc_minutes INTEGER DEFAULT 0,
            PRIMARY KEY (guild_id, stats_date)
        );`,
    ];

    const migrations = [
        // Column normalization
        `DO $$ BEGIN 
            IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='server_id') THEN
                ALTER TABLE subscriptions RENAME COLUMN server_id TO guild_id;
            END IF;
         END $$;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_id TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_enabled BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS antiraid_enabled BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS self_intro_enabled BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS mod_log_channel_id TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS mod_log_flags JSONB DEFAULT '{"ban":true,"kick":true}';`,
        `ALTER TABLE member_stats ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;`,
        `ALTER TABLE member_stats ADD COLUMN IF NOT EXISTS level INTEGER DEFAULT 1;`,
        `ALTER TABLE member_stats ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;`,
        `ALTER TABLE member_stats ADD COLUMN IF NOT EXISTS intro_reminded BOOLEAN DEFAULT FALSE;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS update_announce_channel_id TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS last_notified_version TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leaderboard_enabled BOOLEAN DEFAULT TRUE;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_log_channel_id TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_welcome_msg TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS color_ticket TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_staff_role_id TEXT;`,
        `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS category_id INTEGER;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_panel_title TEXT;`,
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ticket_panel_desc TEXT;`,
    ];

    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_vc_sessions_guild_jointime ON vc_sessions(guild_id, join_time DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_member_stats_guild_xp ON member_stats(guild_id, xp DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_member_events_guild_type ON member_events(guild_id, event_type, created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_created ON ng_logs(guild_id, created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_subscriptions_guild_id ON subscriptions(guild_id);`,
        `CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON tickets(guild_id, status, created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_ng_words_guild_id ON ng_words(guild_id);`,
        `CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(stats_date DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_vc_sessions_user_id ON vc_sessions(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);`,
        `CREATE INDEX IF NOT EXISTS idx_member_stats_user_id ON member_stats(user_id);`,
    ];

    try {
        const allQueries = [...coreTables, ...featureTables, ...migrations, ...indexes];
        for (const query of allQueries) {
            await dbQuery(query);
        }
        console.log("✅ Database initialized (Maintenance simplified)");
        return true;
    } catch (e) {
        console.error("❌ Database initialization failed:", e.message);
        return false;
    }
}

/**
 * Database maintenance: Clear old logs to keep indices fast
 */
export async function cleanupOldData() {
    try {
        console.log("[DB] Starting tiered periodic cleanup & aggregation...");

        // 1. Aggregation: Record daily summary before deleting raw events
        // Sum messages, joins, and leaves for each guild per day (up to yesterday)
        await dbQuery(`
            INSERT INTO daily_stats (guild_id, stats_date, message_count, join_count, leave_count)
            SELECT 
                guild_id, 
                created_at::DATE as stats_date,
                COUNT(*) FILTER (WHERE event_type = 'message') as message_count,
                COUNT(*) FILTER (WHERE event_type = 'join') as join_count,
                COUNT(*) FILTER (WHERE event_type = 'leave') as leave_count
            FROM member_events
            WHERE created_at < CURRENT_DATE
            GROUP BY guild_id, stats_date
            ON CONFLICT (guild_id, stats_date) DO UPDATE SET
                message_count = GREATEST(daily_stats.message_count, EXCLUDED.message_count),
                join_count = GREATEST(daily_stats.join_count, EXCLUDED.join_count),
                leave_count = GREATEST(daily_stats.leave_count, EXCLUDED.leave_count)
        `);

        // 2. NG Logs Cleanup
        const ngRes = await dbQuery(`
            DELETE FROM ng_logs l
            WHERE id IN (
                SELECT sub_l.id FROM ng_logs sub_l
                LEFT JOIN subscriptions s ON sub_l.guild_id = s.guild_id
                WHERE 
                    (COALESCE(s.tier, 0) = 0 AND sub_l.created_at < NOW() - INTERVAL '7 days') OR
                    (COALESCE(s.tier, 0) IN (1, 2, 6) AND sub_l.created_at < NOW() - INTERVAL '30 days') OR
                    (COALESCE(s.tier, 0) IN (3, 4, 5) AND sub_l.created_at < NOW() - INTERVAL '180 days') OR
                    (COALESCE(s.tier, 0) = 999 AND sub_l.created_at < NOW() - INTERVAL '365 days')
            )
        `);

        // 3. Member Events Cleanup (Aggregated data is safe in daily_stats)
        const memRes = await dbQuery(`
            DELETE FROM member_events e
            WHERE id IN (
                SELECT sub_e.id FROM member_events sub_e
                LEFT JOIN subscriptions s ON sub_e.guild_id = s.guild_id
                WHERE 
                    (COALESCE(s.tier, 0) = 0 AND sub_e.created_at < NOW() - INTERVAL '7 days') OR
                    (COALESCE(s.tier, 0) IN (1, 2, 6) AND sub_e.created_at < NOW() - INTERVAL '30 days') OR
                    (COALESCE(s.tier, 0) IN (3, 4, 5) AND sub_e.created_at < NOW() - INTERVAL '180 days') OR
                    (COALESCE(s.tier, 0) = 999 AND sub_e.created_at < NOW() - INTERVAL '365 days')
            )
        `);

        // 4. VC Sessions Cleanup (Also keeps original join/leave for stats purposes temporarily)
        const vcRes = await dbQuery(`
            DELETE FROM vc_sessions v
            WHERE id IN (
                SELECT sub_v.id FROM vc_sessions sub_v
                LEFT JOIN subscriptions s ON sub_v.guild_id = s.guild_id
                WHERE 
                    (COALESCE(s.tier, 0) = 0 AND sub_v.join_time < NOW() - INTERVAL '14 days') OR
                    (COALESCE(s.tier, 0) IN (1, 2, 6) AND sub_v.join_time < NOW() - INTERVAL '60 days') OR
                    (COALESCE(s.tier, 0) IN (3, 4, 5) AND sub_v.join_time < NOW() - INTERVAL '180 days') OR
                    (COALESCE(s.tier, 0) = 999 AND sub_v.join_time < NOW() - INTERVAL '365 days')
            )
        `);

        // 5. Daily Stats Cleanup (Keep only 1 year for ULTIMATE, less for others)
        await dbQuery(`
            DELETE FROM daily_stats
            WHERE id IN (
                SELECT stats_date FROM daily_stats ds
                LEFT JOIN subscriptions s ON ds.guild_id = s.guild_id
                WHERE
                    (COALESCE(s.tier, 0) < 3 AND ds.stats_date < CURRENT_DATE - INTERVAL '60 days') OR
                    (COALESCE(s.tier, 0) >= 3 AND ds.stats_date < CURRENT_DATE - INTERVAL '365 days')
            )
        `);

        console.log(
            `[DB] Aggregation & Cleanup finished. Deleted: NG(${ngRes.rowCount}), Events(${memRes.rowCount}), VC(${vcRes.rowCount})`
        );
    } catch (e) {
        console.error("[DB ERROR] Maintenance failed:", e.message);
    }
}

// Note: Periodic cleanup is now managed by the central cron system in index.js to prevent multiple overlapping cycles.
