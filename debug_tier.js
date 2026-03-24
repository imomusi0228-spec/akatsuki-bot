import { dbQuery, initDb } from "./core/db.js";
import { TIERS } from "./core/tiers.js";

async function check() {
    await initDb();
    const res = await dbQuery("SELECT user_id, tier, guild_id FROM subscriptions WHERE tier = $1", [TIERS.ULTIMATE]);
    console.log("ULTIMATE Subscriptions:");
    res.rows.forEach(r => {
        console.log(`- UserID: [${r.user_id}] (Length: ${r.user_id?.length}), GuildID: [${r.guild_id}], Tier: ${r.tier}`);
    });
    process.exit(0);
}

check();
