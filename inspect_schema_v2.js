import { pool } from "./core/db.js";

async function inspect() {
    try {
        const tables = ['subscriptions', 'settings', 'ng_words', 'vc_sessions'];

        console.log("=== DB SCHEMA REPORT ===");

        for (const table of tables) {
            const res = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position;
            `, [table]);

            console.log(`\nTable: [${table}]`);
            if (res.rows.length === 0) {
                console.log("  ⚠️ TABLE NOT FOUND");
            } else {
                const cols = res.rows.map(r => r.column_name);
                console.log(`  Columns: ${cols.join(', ')}`);

                // Specific checks
                if (table === 'subscriptions') {
                    if (cols.includes('server_id') && !cols.includes('guild_id')) console.log("  🚨 ISSUE: Has 'server_id' but missing 'guild_id'");
                    if (cols.includes('plan_tier') && !cols.includes('tier')) console.log("  🚨 ISSUE: Has 'plan_tier' but missing 'tier'");
                    if (!cols.includes('guild_id')) console.log("  🚨 ISSUE: Missing 'guild_id'");
                }
            }
        }
        console.log("\n=== END REPORT ===");
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

inspect();
