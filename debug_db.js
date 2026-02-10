
import { dbQuery } from "./core/db.js";
import { ENV } from "./config/env.js";

async function debug() {
    try {
        console.log("--- DB Debug ---");
        const settings = await dbQuery("SELECT * FROM settings");
        console.log("Settings:", JSON.stringify(settings.rows, null, 2));

        const logs = await dbQuery("SELECT * FROM ng_logs ORDER BY created_at DESC LIMIT 5");
        console.log("Recent Logs:", JSON.stringify(logs.rows, null, 2));

        const ngWords = await dbQuery("SELECT * FROM ng_words");
        console.log("NG Words:", JSON.stringify(ngWords.rows, null, 2));

        process.exit(0);
    } catch (e) {
        console.error("Debug Error:", e);
        process.exit(1);
    }
}

debug();
