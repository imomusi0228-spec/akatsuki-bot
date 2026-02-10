import { dbQuery, pool } from "../core/db.js";
import fs from "fs";

(async () => {
    try {
        const tables = ['settings', 'ng_words', 'vc_sessions', 'subscriptions'];
        let output = "🔍 Inspecting Database Columns...\n";

        for (const table of tables) {
            const res = await dbQuery(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position
            `, [table]);

            const columns = res.rows.map(r => r.column_name);
            output += `\n📊 Table: ${table}\n`;
            output += `   Columns: ${columns.length > 0 ? columns.join(", ") : "❌ NO COLUMNS FOUND"}\n`;
        }
        output += "\n--- End of report ---\n";
        fs.writeFileSync("db_inspection.txt", output);
        console.log("✅ Inspection report written to db_inspection.txt");

    } catch (e) {
        console.error("❌ Inspection failed:", e);
    } finally {
        await pool.end();
    }
})();
