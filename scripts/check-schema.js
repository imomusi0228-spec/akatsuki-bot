import { dbQuery } from "../core/db.js";

async function checkSchema() {
    try {
        const res = await dbQuery("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'settings'");
        console.table(res.rows);
    } catch (e) {
        console.error("Error:", e);
    }
    process.exit(0);
}

checkSchema();
