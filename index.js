import { ENV } from "./config/env.js";
import { initDb } from "./core/db.js";
import { loadCommands, startBot } from "./core/client.js";
import { loadEvents } from "./core/eventLoader.js";
import { startServer } from "./core/server.js";

import { runEngagementCheck } from "./services/engagement.js";
import { runDataPruning } from "./services/pruning.js";
import { runInsightCheck } from "./services/insight.js";
import { runIntroReminder } from "./services/introReminder.js";
import { runAutoRecoveryCheck } from "./services/antiraidRecovery.js";


// Global Error Handlers for Production Stability
process.on("uncaughtException", (err) => {
    console.error("🔥 [FATAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("🔥 [FATAL] Unhandled Rejection:", reason);
});

(async () => {
    console.log("🚀 Booting Akatsuki Bot (v2.5.8)...");

    try {
        // 1. Initialize Database
        await initDb();

        // 2. Load and Register Commands/Events
        await loadCommands();
        await loadEvents();


        // 3. Start Web Server
        await startServer();

        // 4. Connect to Discord
        await startBot();

        // 5. Start Background Tasks
        console.log("⚙️  Initializing Background Tasks...");

        const runTasks = async () => {
            await runEngagementCheck();
            await new Promise(r => setTimeout(r, 5000)); // 5s delay
            await runDataPruning();
            await new Promise(r => setTimeout(r, 5000));
            await runInsightCheck();
            await new Promise(r => setTimeout(r, 5000));
            await runIntroReminder();
            await new Promise(r => setTimeout(r, 5000));
            await runAutoRecoveryCheck();
        };


        runTasks(); // Initial run (async)

        setInterval(runEngagementCheck, 60 * 60 * 1000);      // 1 hour
        setInterval(runDataPruning, 24 * 60 * 60 * 1000);     // 24 hours
        setInterval(runInsightCheck, 2 * 60 * 60 * 1000);     // 2 hours
        setInterval(runIntroReminder, 6 * 60 * 60 * 1000);    // 6 hours
        setInterval(runAutoRecoveryCheck, 10 * 60 * 1000);   // 10 minutes


        console.log("✅ All systems initialized successfully.");
    } catch (e) {
        console.error("❌ Boot Failed:", e.message);
        // We keep the server running if possible for log accessibility
    }
})();
