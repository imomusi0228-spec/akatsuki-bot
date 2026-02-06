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
    console.log("▶️  Step 3: Starting Web Server...");
    await startServer();

    // 4. Login
    console.log("▶️  Step 4: Logging into Discord...");

    // Add Debug Logging
    client.on("debug", (m) => {
        if (m.includes("Heartbeat")) return; // Reduce noise
        console.log(`[DEBUG] ${m}`);
    });
    client.on("ready", () => console.log("✅ Client Ready event received!"));

    try {
        if (!ENV.TOKEN) throw new Error("DISCORD_TOKEN is missing");

        // Login direct await
        await client.login(ENV.TOKEN);

        console.log("✅ Discord login OK");
    } catch (e) {
        console.error("❌ Discord login FAILED:", e);
        // Do not exit process, let web server run so we can see logs
    }
})();
