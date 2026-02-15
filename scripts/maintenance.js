import { pool, dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { ENV } from "../config/env.js";

async function checkDatabase() {
    console.log("📊 Checking Database Health...");
    try {
        const start = Date.now();
        const res = await dbQuery("SELECT 1 as health");
        const duration = Date.now() - start;
        if (res.rows[0].health === 1) {
            console.log(`   ✅ Database Connected (${duration}ms)`);
        }

        // Count some stats
        const subs = await dbQuery("SELECT COUNT(*) as cnt FROM subscriptions");
        const logs = await dbQuery("SELECT COUNT(*) as cnt FROM ng_logs");
        console.log(`   ✅ Subscriptions: ${subs.rows[0].cnt}`);
        console.log(`   ✅ NG Logs: ${logs.rows[0].cnt}`);
    } catch (e) {
        console.error("   ❌ Database Health Check Failed:", e.message);
    }
}

async function checkDiscord() {
    console.log("🌐 Checking Discord Connectivity...");
    try {
        if (!ENV.TOKEN) {
            console.log("   ⚠️ DISCORD_TOKEN is missing.");
            return;
        }

        await client.login(ENV.TOKEN);
        console.log(`   ✅ Discord Authenticated as ${client.user.tag}`);
        console.log(`   ✅ Servicing ${client.guilds.cache.size} guilds`);
        await client.destroy();
    } catch (e) {
        console.error("   ❌ Discord Connectivity Check Failed:", e.message);
    }
}

(async () => {
    console.log("🧹 Starting Akatsuki Bot Maintenance Check...");
    console.log("------------------------------------------");

    await checkDatabase();
    await checkDiscord();

    console.log("------------------------------------------");
    console.log("✨ Maintenance Check Completed.");
    process.exit(0);
})();
