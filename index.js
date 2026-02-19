import { ENV } from "./config/env.js";
import { initDb } from "./core/db.js";
import { loadCommands, startBot } from "./core/client.js";
import { loadEvents } from "./core/eventLoader.js";
import { startServer } from "./core/server.js";
import { registerCommands } from "./register-commands.js";
import { runEngagementCheck } from "./services/engagement.js";
import { runAnnouncerCheck } from "./services/announcer.js";
import { runDataPruning } from "./services/pruning.js";
import { runInsightCheck } from "./services/insight.js";


// Global Error Handlers for Production Stability
process.on("uncaughtException", (err) => {
    console.error("🔥 [FATAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("🔥 [FATAL] Unhandled Rejection:", reason);
});

(async () => {
    console.log("🚀 Booting Akatsuki Bot (v1.7.1)...");

    try {
        // 1. Initialize Database
        await initDb();

        // 2. Load and Register Commands/Events
        await loadCommands();
        await loadEvents();
        await registerCommands();

        // 3. Start Web Server
        await startServer();

        // 4. Connect to Discord
        await startBot();

        // 5. Start Background Tasks
        console.log("⚙️  Initializing Background Tasks...");

        const runTasks = () => {
            runEngagementCheck();
            runAnnouncerCheck();
            runDataPruning();
            runInsightCheck();
        };


        runTasks(); // Initial run

        setInterval(runEngagementCheck, 60 * 60 * 1000);    // 1 hour
        setInterval(runAnnouncerCheck, 24 * 60 * 60 * 1000);  // 24 hours
        setInterval(runDataPruning, 24 * 60 * 60 * 1000);    // 24 hours
        setInterval(runInsightCheck, 2 * 60 * 60 * 1000);    // 2 hours check


        console.log("✅ All systems initialized successfully.");
    } catch (e) {
        console.error("❌ Boot Failed:", e.message);
        // We keep the server running if possible for log accessibility
    }
})();
