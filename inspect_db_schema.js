import { pool } from "./core/db.js";

async function inspect() {
    try {
        const tables = ['subscriptions', 'settings', 'ng_words', 'vc_sessions'];

        for (const table of tables) {
            console.log(`\n--- Table: ${table} ---`);
            const res = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position;
            `, [table]);

            if (res.rows.length === 0) {
                console.log("  (Table not found)");
            } else {
                res.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type})`));
            }
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

inspect();
