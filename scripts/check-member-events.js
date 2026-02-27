import { dbQuery } from "../core/db.js";

async function checkData() {
    try {
        const res = await dbQuery(`
            SELECT guild_id, event_type, COUNT(*) as cnt
            FROM member_events
            GROUP BY guild_id, event_type
            ORDER BY cnt DESC
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    }
}

checkData();
