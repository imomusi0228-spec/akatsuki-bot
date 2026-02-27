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
    console.log("🚀 Booting Akatsuki Bot (v2.7.3)...");

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

        // 5. Start Background Tasks (A-2)
        console.log("⚙️  Initializing Background Tasks (node-cron)...");
        const cron = await import("node-cron");

        const VERSION = "2.9.2";

        // Engagement check: Every hour
        cron.default.schedule("0 * * * *", () => {
            console.log("[CRON] Starting Engagement Check...");
            runEngagementCheck();
        });

        // Data Pruning: Every day at 03:00
        cron.default.schedule("0 3 * * *", () => {
            console.log("[CRON] Starting Data Pruning...");
            runDataPruning();
        });

        // Insight check: Every 2 hours
        cron.default.schedule("0 */2 * * *", () => {
            console.log("[CRON] Starting Insight Check...");
            runInsightCheck();
        });

        // Intro reminder: Every 6 hours
        cron.default.schedule("0 */6 * * *", () => {
            console.log("[CRON] Starting Intro Reminder...");
            runIntroReminder();
        });

        // Auto Recovery check: Every 10 minutes
        cron.default.schedule("*/10 * * * *", () => {
            runAutoRecoveryCheck();
        });

        // Weekly Update Notification (Friday 21:00)
        const { runAutoUpdateCheck } = await import("./services/autoUpdateNotifier.js");
        cron.default.schedule("0 21 * * 5", () => {
            console.log("[CRON] Starting Weekly Update Check...");
            runAutoUpdateCheck();
        });

        // Initial small delay check for critical tasks if needed
        setTimeout(() => {
            runAutoRecoveryCheck(); // Important to run early
        }, 5000);


        console.log("✅ All systems initialized successfully.");
    } catch (e) {
        console.error("❌ Boot Failed:", e.message);
        // We keep the server running if possible for log accessibility
    }
})();
