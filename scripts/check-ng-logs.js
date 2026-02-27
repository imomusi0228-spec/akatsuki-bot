import { dbQuery } from "../core/db.js";

async function checkNgLogs() {
    try {
        const res = await dbQuery(`
            SELECT guild_id, COUNT(*) as cnt
            FROM ng_logs
            GROUP BY guild_id
            ORDER BY cnt DESC
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}

checkNgLogs();
