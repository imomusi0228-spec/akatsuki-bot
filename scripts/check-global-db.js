import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

async function check() {
    try {
        const res = await dbQuery(
            "SELECT guild_id, last_notified_version FROM settings WHERE guild_id = 'GLOBAL'"
        );
        console.log("GLOBAL Settings:", res.rows);
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

check();
