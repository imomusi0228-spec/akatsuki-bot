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
            // Migration: Add missing columns if table already exists from older versions
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS join_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS leave_time TIMESTAMPTZ;`,
            `ALTER TABLE vc_sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;`
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
