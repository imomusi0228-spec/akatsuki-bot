import { ENV } from "./config/env.js";
import { initDb } from "./core/db.js";
import { loadCommands, startBot } from "./core/client.js";
import { loadEvents } from "./core/eventLoader.js";
import { startServer } from "./core/server.js";

import { runEngagementCheck } from "./services/engagement.js";
import { runInsightCheck } from "./services/insight.js";
import { runIntroReminder } from "./services/introReminder.js";
import { runAutoRecoveryCheck } from "./services/antiraidRecovery.js";
import { cleanupOldData } from "./core/db.js";

// Global Error Handlers for Production Stability
process.on("uncaughtException", (err) => {
    console.error("🔥 [FATAL] Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
    console.error("🔥 [FATAL] Unhandled Rejection:", reason);
});

const VERSION = "2.9.2";

(async () => {
    console.log(`🚀 Booting AkatsukiBot (v${VERSION})...`);

    try {
        await initDb();
        await loadCommands();
        await loadEvents();
        await startServer();
        await startBot();

        console.log("⚙️  Initializing Background Tasks...");
        const cron = await import("node-cron");

        // Schedule Background Tasks
        cron.default.schedule("0 * * * *", runEngagementCheck);
        cron.default.schedule("0 3 * * *", cleanupOldData);
        cron.default.schedule("0 */2 * * *", runInsightCheck);
        cron.default.schedule("0 */6 * * *", runIntroReminder);
        cron.default.schedule("*/10 * * * *", runAutoRecoveryCheck);

        const { runAutoUpdateCheck } = await import("./services/autoUpdateNotifier.js");
        cron.default.schedule("0 21 * * 5", runAutoUpdateCheck);

        setTimeout(runAutoRecoveryCheck, 5000);

        console.log("✅ All systems initialized successfully.");
    } catch (e) {
        console.error("❌ Boot Failed:", e.message);
    }
})();
