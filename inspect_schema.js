import { dbQuery } from "./core/db.js";
import fs from "fs";

async function inspect() {
    const tables = ['settings', 'ng_words', 'vc_sessions', 'subscriptions', 'ng_logs'];
    let report = "--- DB SCHEMA REPORT START ---\n";
    for (const table of tables) {
        try {
            const res = await dbQuery(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            report += `\n[Table: ${table}]\n`;
            if (res.rows.length === 0) {
                report += "  (Table not found or no columns)\n";
            } else {
                res.rows.forEach(r => {
                    report += `  - ${r.column_name} (${r.data_type})\n`;
                });
            }
        } catch (e) {
            report += `  Error inspecting table ${table}: ${e.message}\n`;
        }
    }
    report += "\n--- DB SCHEMA REPORT END ---\n";
    fs.writeFileSync("schema_report.txt", report);
    process.exit(0);
}

inspect();
