import { dbQuery, initDb } from "./core/db.js";
import fs from "fs";

(async () => {
    await initDb();
    const result = {
        distribution: [],
        last5: []
    };

    const distRes = await dbQuery("SELECT status, COUNT(*) as cnt FROM tickets GROUP BY status");
    result.distribution = distRes.rows;

    const lastRes = await dbQuery("SELECT id, guild_id, status, created_at FROM tickets ORDER BY created_at DESC LIMIT 5");
    result.last5 = lastRes.rows;

    fs.writeFileSync("debug_out.json", JSON.stringify(result, null, 2));
    process.exit();
})();
