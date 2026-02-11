import { pool } from "./core/db.js";

async function fix() {
    try {
        console.log("=== STARTING FIX ===");

        // 1. Fix 'subscriptions' - server_id -> guild_id
        console.log("Checking 'subscriptions' for 'server_id' -> 'guild_id'...");
        try {
            await pool.query(`
                DO $$ 
                BEGIN 
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='server_id') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='guild_id') THEN
                            ALTER TABLE subscriptions RENAME COLUMN server_id TO guild_id;
                            RAISE NOTICE 'Renamed server_id to guild_id';
                        ELSE
                            -- Both exist, maybe drop legacy?
                            -- For now, let's just ensure guild_id has data
                            UPDATE subscriptions SET guild_id = server_id WHERE guild_id IS NULL;
                        END IF;
                    END IF;
                END $$;
            `);
            console.log("✅ server_id check done.");
        } catch (e) {
            console.error("❌ Failed server_id rename:", e.message);
        }

        // 2. Fix 'subscriptions' - plan_tier -> tier
        console.log("Checking 'subscriptions' for 'plan_tier' -> 'tier'...");
        try {
            await pool.query(`
                DO $$ 
                BEGIN 
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='plan_tier') THEN
                        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscriptions' AND column_name='tier') THEN
                            ALTER TABLE subscriptions RENAME COLUMN plan_tier TO tier;
                             RAISE NOTICE 'Renamed plan_tier to tier';
                        END IF;
                    END IF;
                END $$;
            `);
            console.log("✅ plan_tier check done.");
        } catch (e) {
            console.error("❌ Failed plan_tier rename:", e.message);
        }

        // 3. Ensure 'guild_id' exists if it was missing completely
        try {
            await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS guild_id TEXT;`);
            console.log("✅ Ensured guild_id column exists.");
        } catch (e) {
            console.error("❌ Failed to add guild_id:", e.message);
        }

        // 4. Ensure 'tier' exists
        try {
            await pool.query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tier INTEGER DEFAULT 0;`);
            console.log("✅ Ensured tier column exists.");
        } catch (e) {
            console.error("❌ Failed to add tier:", e.message);
        }

        console.log("=== FIX COMPLETE ===");
    } catch (e) {
        console.error("Global Error:", e);
    } finally {
        await pool.end();
    }
}

fix();
