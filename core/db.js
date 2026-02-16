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

    try {
        const queries = [
            `CREATE TABLE IF NOT EXISTS settings (
                guild_id TEXT PRIMARY KEY,
                log_channel_id TEXT,
                log_channel_name TEXT,
                ng_threshold INTEGER DEFAULT 3,
                timeout_minutes INTEGER DEFAULT 10,
                autorole_id TEXT,
                autorole_enabled BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `CREATE TABLE IF NOT EXISTS ng_words (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                word TEXT NOT NULL,
                kind TEXT DEFAULT 'exact',
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `CREATE TABLE IF NOT EXISTS vc_sessions (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                join_time TIMESTAMPTZ NOT NULL,
                leave_time TIMESTAMPTZ,
                duration_seconds INTEGER
            );`,
            `CREATE TABLE IF NOT EXISTS subscriptions (
                guild_id TEXT PRIMARY KEY,
                tier INTEGER DEFAULT 0,
                valid_until TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='server_id') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='guild_id') THEN
                        ALTER TABLE subscriptions DROP COLUMN server_id;
                    ELSE
                        ALTER TABLE subscriptions RENAME COLUMN server_id TO guild_id;
                    END IF;
                END IF;

                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_tier') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='tier') THEN
                        ALTER TABLE subscriptions DROP COLUMN plan_tier;
                    ELSE
                        ALTER TABLE subscriptions RENAME COLUMN plan_tier TO tier;
                    END IF;
                END IF;
            END $$;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 0;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`,

            `DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='join_ts') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='join_time') THEN
                        ALTER TABLE vc_sessions DROP COLUMN join_ts;
                    ELSE
                        ALTER TABLE vc_sessions RENAME COLUMN join_ts TO join_time;
                    END IF;
                END IF;

                IF EXISTS (
                    SELECT 1 
                    FROM information_schema.table_constraints tc 
                    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name 
                    WHERE tc.table_name = 'vc_sessions' 
                    AND tc.constraint_type = 'PRIMARY KEY' 
                    AND kcu.column_name != 'id'
                ) THEN
                    ALTER TABLE vc_sessions DROP CONSTRAINT vc_sessions_pkey;
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='id') THEN
                        ALTER TABLE vc_sessions ADD COLUMN id SERIAL;
                    END IF;
                    ALTER TABLE vc_sessions ADD PRIMARY KEY (id);
                ELSIF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints 
                    WHERE table_name = 'vc_sessions' AND constraint_type = 'PRIMARY KEY'
                ) THEN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='id') THEN
                        ALTER TABLE vc_sessions ADD COLUMN id SERIAL;
                    END IF;
                    ALTER TABLE vc_sessions ADD PRIMARY KEY (id);
                END IF;
            END $$;`,

            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS channel_id TEXT;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS join_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS leave_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;`,

            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS log_channel_name TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`,

            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS created_by TEXT;`,
            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`,

            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS intro_channel_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS audit_role_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS ng_log_channel_id TEXT;`,

            `CREATE TABLE IF NOT EXISTS ng_logs (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                word TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_user ON ng_logs(guild_id, user_id);`,

            `CREATE TABLE IF NOT EXISTS member_events (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                event_type TEXT NOT NULL, -- 'join' or 'leave'
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `CREATE INDEX IF NOT EXISTS idx_vc_sessions_guild_user ON vc_sessions(guild_id, user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_vc_sessions_join ON vc_sessions(join_time);`,
            `CREATE INDEX IF NOT EXISTS idx_vc_sessions_guild_jointime ON vc_sessions(guild_id, join_time);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_words_guild ON ng_words(guild_id);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_created ON ng_logs(guild_id, created_at);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_user_recent ON ng_logs(user_id, created_at);`,
            `CREATE INDEX IF NOT EXISTS idx_member_events_guild_type ON member_events(guild_id, event_type, created_at);`,
            `CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_subscriptions_guild_id ON subscriptions(guild_id);`,

            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS antiraid_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS antiraid_threshold INTEGER DEFAULT 10;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS self_intro_role_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS self_intro_min_length INTEGER DEFAULT 10;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS self_intro_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vc_report_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vc_report_channel_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vc_report_interval TEXT DEFAULT 'weekly';`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vc_report_last_sent TIMESTAMPTZ;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS vc_role_rules JSONB DEFAULT '[]';`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_milestone INT DEFAULT 1;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS auto_unlock_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS last_announced_version TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS alpha_features JSONB DEFAULT '[]';`
        ];

        for (const query of queries) {
            await dbQuery(query);
        }
        console.log("✅ Database initialized (Tables ready)");
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
        console.log("[DB] Starting periodic cleanup...");
        const ngRes = await dbQuery("DELETE FROM ng_logs WHERE created_at < NOW() - INTERVAL '30 days'");
        const memRes = await dbQuery("DELETE FROM member_events WHERE created_at < NOW() - INTERVAL '30 days'");
        const vcRes = await dbQuery("DELETE FROM vc_sessions WHERE join_time < NOW() - INTERVAL '60 days'");

        console.log(`[DB] Cleanup finished. Deleted logs: NG(${ngRes.rowCount || 0}), Events(${memRes.rowCount || 0}), VC(${vcRes.rowCount || 0})`);
    } catch (e) {
        console.error("[DB ERROR] Maintenance failed:", e.message);
    }
}

// Run once every 24 hours
setInterval(cleanupOldData, 24 * 60 * 60 * 1000);
