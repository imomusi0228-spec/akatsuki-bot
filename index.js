import { ENV } from "./config/env.js";
import { initDb } from "./core/db.js";
import { client, loadCommands } from "./core/client.js";
import { loadEvents } from "./core/eventLoader.js";
import { startServer } from "./core/server.js";
import { registerCommands } from "./register-commands.js";
import { runEngagementCheck } from "./services/engagement.js";
import { runAnnouncerCheck } from "./services/announcer.js";

// Global Error Handlers
process.on("uncaughtException", (err) => {
    console.error("🔥 Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
    console.error("🔥 Unhandled Rejection:", promise, "reason:", reason);
});

(async () => {
    console.log("🚀  Booting Akatsuki Bot...");
    console.log("    Environment Token:", ENV.TOKEN ? `Present (${ENV.TOKEN.length} chars)` : "MISSING");

    // 1. Initialize Database
    await initDb();

    // 2. Load Event Handlers
    await loadCommands();
    await loadEvents();

    // 3. Register Commands
    await registerCommands();

    // 4. Start Web Server
    await startServer();

    // 5. Login
    console.log("⏳ Logging into Discord...");

    // Add Debug Logging


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



    try {
        if (!ENV.TOKEN) throw new Error("DISCORD_TOKEN is missing");

        // Login direct await
        console.log("⏳ Calling client.login()...");
        await client.login(ENV.TOKEN);

        console.log("✅ Discord login OK");

        // 6. Start Background Tasks
        runEngagementCheck();
        runAnnouncerCheck();
        setInterval(runEngagementCheck, 60 * 60 * 1000); // Every 1 hour
        setInterval(runAnnouncerCheck, 24 * 60 * 60 * 1000); // Every 24 hours for broadcasts/unlocks
    } catch (e) {
        console.error("❌ Discord login FAILED:", e);
        // Do not exit process, let web server run so we can see logs
    }
})();
