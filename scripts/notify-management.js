import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

async function notify() {
    try {
        const logPath = path.join(process.cwd(), "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        // 一番上のリリースノートを抽出
        // format: # Akatsuki Bot v1.2.1 リリースノート ... ---
        const sections = content.split("---");
        if (sections.length === 0) {
            console.error("No release notes found in UPDATE_LOG.md");
            return;
        }

        const latestSection = sections[0].trim();
        const titleMatch = latestSection.match(/# (.*?)\n/);
        const title = titleMatch ? titleMatch[1] : "Akatsuki Bot Update";

        // タイトル行を削除して残りをコンテンツに
        const bodyContent = latestSection.replace(/^# .*?\n/, "").trim();

        console.log(`Sending update: ${title}`);

        const managementUrl = process.env.MANAGEMENT_API_URL || "http://localhost:3000";
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken) {
            console.error("ADMIN_TOKEN is not set in .env");
            return;
        }

        const response = await fetch(`${managementUrl}/api/updates/receive`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                title: title,
                content: bodyContent,
                token: adminToken
            })
        });

        const result = await response.json();
        if (response.ok) {
            console.log("✅ Success:", result.message);
        } else {
            console.error("❌ Failed:", result.error || response.statusText);
        }
    } catch (error) {
        console.error("🔥 Error:", error.message);
    }
}

notify();
