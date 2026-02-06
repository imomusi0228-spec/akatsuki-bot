import { ENV } from "./config/env.js";
import { initDb } from "./core/db.js";
import { client } from "./core/client.js";
import { loadEvents } from "./core/eventLoader.js";
import { startServer } from "./core/server.js";

// Global Error Handlers
process.on("uncaughtException", (err) => {
    console.error("🔥 Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
    console.error("🔥 Unhandled Rejection:", promise, "reason:", reason);
});

(async () => {
    console.log("▶️  Step 0: Bootstrapping...");
    console.log("    Environment Token:", ENV.TOKEN ? `Present (${ENV.TOKEN.length} chars)` : "MISSING");

    // 1. Initialize Database
    console.log("▶️  Step 1: Initializing Database...");
    await initDb();

    // 2. Load Event Handlers
    console.log("▶️  Step 2: Loading Events...");
    await loadEvents();

    // 3. Start Web Server
    console.log("▶️  Step 3: Starting Web Server (with Health Check)...");
    await startServer();

    // 4. Login
    console.log("▶️  Step 4: Logging into Discord...");

    // Add Debug Logging
    // Network Diagnostic
    console.log("🔍 Running network diagnostic...");
    try {
        const start = Date.now();
        const res = await fetch("https://discord.com");
        console.log(`✅ [Network Check] Discord Reachable: YES (Status: ${res.status}, Time: ${Date.now() - start}ms)`);
    } catch (netErr) {
        console.error(`❌ [Network Check] Failed to reach Discord:`, netErr.message);
    }

    // Token Validation via REST
    console.log("🔑 Validating token via REST API...");
    try {
        const userRes = await fetch("https://discord.com/api/v10/users/@me", {
            headers: { Authorization: `Bot ${ENV.TOKEN}` }
        });
        const userData = await userRes.json();
        console.log(`🔑 [Token Check] Status: ${userRes.status}`);
        if (userRes.ok) {
            console.log(`🔑 [Token Check] Bot Account: ${userData.username}#${userData.discriminator} (ID: ${userData.id})`);
        } else {
            console.error(`❌ [Token Check] Failed:`, JSON.stringify(userData));
        }
    } catch (err) {
        console.error(`❌ [Token Check] Request Error:`, err);
    }

    // Detailed WebSocket Logging for Debugging
    client.on("debug", (m) => {
        // Log EVERYTHING to find the stuck point
        console.log(`🛠️ [DEBUG] ${m}`);
    });

    client.ws.on("error", (err) => console.error("❌ [WS] Error:", err));
    client.ws.on("close", (code, reason) => console.warn(`⚠️ [WS] Closed: ${code} - ${reason}`));
    client.ws.on("reconnecting", () => console.log("🔄 [WS] Reconnecting..."));

    // Status Monitor Loop
    const statusMap = {
        0: "READY",
        1: "CONNECTING",
        2: "RECONNECTING",
        3: "IDLE",
        4: "NEARLY",
        5: "DISCONNECTED",
        6: "WAITING_FOR_GUILDS",
        7: "IDENTIFYING",
        8: "RESUMING"
    };

    setInterval(() => {
        const status = client.ws.status;
        console.log(`⏱️ [Status Watch] State: ${statusMap[status] || status} (${status}) | Ping: ${client.ws.ping}ms`);
    }, 5000).unref(); // unref so it doesn't block exit if we want to shut down

    try {
        if (!ENV.TOKEN) throw new Error("DISCORD_TOKEN is missing");

        // Login direct await
        console.log("⏳ Calling client.login()...");
        await client.login(ENV.TOKEN);

        console.log("✅ Discord login OK");
    } catch (e) {
        console.error("❌ Discord login FAILED:", e);
        // Do not exit process, let web server run so we can see logs
    }
})();
