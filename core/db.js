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
    if (!ENV.DATABASE_URL) {
        console.error("❌ DATABASE_URL is EMPTY");
        return false;
    }

    try {
        const url = new URL(ENV.DATABASE_URL);
        console.log(`📡 Database attempt: protocol=${url.protocol}, host=${url.hostname}, port=${url.port}, db=${url.pathname.substring(1)}`);
    } catch (e) {
        console.log(`📡 Database attempt (manual parse): ${ENV.DATABASE_URL.substring(0, 15)}...`);
    }

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
        );`
    ];

    const featureTables = [
        `CREATE TABLE IF NOT EXISTS ng_words (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, word TEXT NOT NULL, kind TEXT DEFAULT 'exact', created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS vc_sessions (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, join_time TIMESTAMPTZ NOT NULL, leave_time TIMESTAMPTZ, duration_seconds INTEGER);`,
        `CREATE TABLE IF NOT EXISTS ng_logs (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, word TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS warnings (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT, issued_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS tickets (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT DEFAULT 'open', created_at TIMESTAMPTZ DEFAULT NOW());`,
        `CREATE TABLE IF NOT EXISTS member_events (id SERIAL PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, event_type TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW());`
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
        `ALTER TABLE settings ADD COLUMN IF NOT EXISTS leaderboard_enabled BOOLEAN DEFAULT TRUE;`
    ];

    const indexes = [
        `CREATE INDEX IF NOT EXISTS idx_vc_sessions_guild_jointime ON vc_sessions(guild_id, join_time DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_member_stats_guild_xp ON member_stats(guild_id, xp DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_member_events_guild_type ON member_events(guild_id, event_type, created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_created ON ng_logs(guild_id, created_at DESC);`,
        `CREATE INDEX IF NOT EXISTS idx_subscriptions_guild_id ON subscriptions(guild_id);`
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
        console.log("[DB] Starting periodic cleanup (Optimized)...");
        // Using batching if necessary, but these are simple date-based deletes which hit indexes
        const ngRes = await dbQuery("DELETE FROM ng_logs WHERE created_at < NOW() - INTERVAL '30 days'");
        const memRes = await dbQuery("DELETE FROM member_events WHERE created_at < NOW() - INTERVAL '30 days'");
        const vcRes = await dbQuery("DELETE FROM vc_sessions WHERE join_time < NOW() - INTERVAL '60 days'");

        console.log(`[DB] Cleanup finished. Deleted logs: NG(${ngRes.rowCount}), Events(${memRes.rowCount}), VC(${vcRes.rowCount})`);
    } catch (e) {
        console.error("[DB ERROR] Maintenance failed:", e.message);
    }
}

// Run once every 24 hours
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
