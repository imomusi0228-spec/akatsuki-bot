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

    // Debug: Parse and log connection string (masking password)
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
            // Comprehensive Migration & Column Normalization
            // Fix subscriptions table (Legacy names: server_id, plan_tier)
            `DO $$ 
            BEGIN 
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='server_id') THEN
                    ALTER TABLE subscriptions RENAME COLUMN server_id TO guild_id;
                END IF;
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_tier') THEN
                    ALTER TABLE subscriptions RENAME COLUMN plan_tier TO tier;
                END IF;
            END $$;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 0;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id VARCHAR(64);`,
            `ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`,

            // Fix vc_sessions legacy columns
            `DO $$ 
            BEGIN 
                -- Handle join_ts -> join_time migration
                IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='join_ts') THEN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='join_time') THEN
                        -- Both exist, drop legacy join_ts
                        ALTER TABLE vc_sessions DROP COLUMN join_ts;
                    ELSE
                        -- Only join_ts exists, rename it
                        ALTER TABLE vc_sessions RENAME COLUMN join_ts TO join_time;
                    END IF;
                END IF;

                -- Ensure ID exists
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='vc_sessions' AND column_name='id') THEN
                    ALTER TABLE vc_sessions ADD COLUMN id SERIAL;
                END IF;
            END $$;`,

            // Fix vc_sessions
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS join_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS leave_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;`,

            // Fix settings
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS log_channel_name TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS autorole_enabled BOOLEAN DEFAULT FALSE;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`,

            // Fix ng_words
            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS guild_id TEXT;`,
            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS created_by TEXT;`,
            `ALTER TABLE ng_words ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`,

            // Fix settings (Missing columns for Audit)
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS intro_channel_id TEXT;`,
            `ALTER TABLE settings ADD COLUMN IF NOT EXISTS audit_role_id TEXT;`,

            // Create ng_logs
            `CREATE TABLE IF NOT EXISTS ng_logs (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                word TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_user ON ng_logs(guild_id, user_id);`,

            // Performance Indices
            `CREATE INDEX IF NOT EXISTS idx_vc_sessions_guild_user ON vc_sessions(guild_id, user_id);`,
            `CREATE INDEX IF NOT EXISTS idx_vc_sessions_join ON vc_sessions(join_time);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_words_guild ON ng_words(guild_id);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_guild_created ON ng_logs(guild_id, created_at);`,
            `CREATE INDEX IF NOT EXISTS idx_ng_logs_user_recent ON ng_logs(user_id, created_at);`
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
