import { dbQuery } from "./core/db.js";
(async () => {
    try {
        const res = await dbQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'subscriptions'");
        console.log("Columns:", res.rows.map(r => r.column_name));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
