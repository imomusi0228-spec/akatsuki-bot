import { initDb, dbQuery } from "./core/db.js";
import fs from "fs";

async function verify() {
    console.log("▶️  Running initDb()...");
    const initialized = await initDb();
    if (!initialized) {
        console.error("❌ initDb failed");
        process.exit(1);
    }

    const tables = ['settings', 'ng_words', 'vc_sessions', 'subscriptions', 'ng_logs'];
    let report = "--- DB SCHEMA VERIFICATION REPORT ---\n";
    for (const table of tables) {
        try {
            const res = await dbQuery(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1
                ORDER BY ordinal_position
            `, [table]);
            report += `\n[Table: ${table}]\n`;
            res.rows.forEach(r => {
                report += `  - ${r.column_name} (${r.data_type})\n`;
            });
        } catch (e) {
            report += `  Error: ${e.message}\n`;
        }
    }
    fs.writeFileSync("verification_report.txt", report);
    console.log("✅ Verification report generated: verification_report.txt");
    process.exit(0);
}

verify();
