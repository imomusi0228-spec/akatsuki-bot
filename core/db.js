import pg from "pg";
import { ENV } from "../config/env.js";

const { Pool } = pg;

export const pool = new Pool({
    connectionString: ENV.DATABASE_URL,
    ssl: ENV.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

export const dbQuery = (text, params) => pool.query(text, params);

export async function initDb() {
    if (!ENV.DATABASE_URL) return false;
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS settings (
                guild_id TEXT PRIMARY KEY,
                log_channel_id TEXT,
                log_channel_name TEXT,
                ng_threshold INTEGER DEFAULT 3,
                timeout_minutes INTEGER DEFAULT 10,
                autorole_id TEXT,
                autorole_enabled BOOLEAN DEFAULT FALSE,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS ng_words (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                word TEXT NOT NULL,
                kind TEXT DEFAULT 'exact', -- exact, regex
                created_by TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS vc_sessions (
                id SERIAL PRIMARY KEY,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                join_time TIMESTAMPTZ NOT NULL,
                leave_time TIMESTAMPTZ,
                duration_seconds INTEGER
            );
            CREATE TABLE IF NOT EXISTS subscriptions (
                guild_id TEXT PRIMARY KEY,
                tier INTEGER DEFAULT 0,
                valid_until TIMESTAMPTZ,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            -- Optional: We can use memory for web sessions to keep it simple, 
            -- or DB if requested later. For now, sticking to memory in middleware/auth.js logic.
        `);
        console.log("✅ Database initialized (Tables ready)");
        return true;
    } catch (e) {
        console.error("❌ Database initialization failed:", e);
        return false;
    }
}
