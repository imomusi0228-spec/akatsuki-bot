import fs from "node:fs/promises";
import path from "node:path";
import { dbQuery } from "../core/db.js";
import { ENV } from "../config/env.js";

/**
 * UPDATE_LOG.md をチェックし、未通知の新バージョンがあれば管理ボットへ通知する
 * ※ 毎週金曜 21:00 に index.js から呼び出されることを想定
 */
export async function runAutoUpdateCheck() {
    try {
        console.log("[AutoUpdate] Checking for new updates...");

        const logPath = path.join(process.cwd(), "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        // ## v2.x.x 形式で最新セクションを抽出
        const sectionRegex = /^(## v(\d+\.\d+\.\d+)[\s\S]*?)(?=\n## v|\n# |$)/m;
        const match = content.match(sectionRegex);
        if (!match) return;

        const latestSection = match[1].trim();
        const version = match[2];

        // グローバルな通知済みバージョンを確認
        const globalRes = await dbQuery(
            "SELECT last_notified_version FROM settings WHERE guild_id = 'GLOBAL'",
            []
        );

        const lastVersion = globalRes.rows.length > 0 ? globalRes.rows[0].last_notified_version : null;

        if (lastVersion === version) {
            console.log(`[AutoUpdate] Version ${version} is already notified. Skipping.`);
            return;
        }

        // 内容の判別とカラーの決定
        const isFix = latestSection.includes("システム修正");
        const title = isFix
            ? `システム修正のお知らせ（v${version}）`
            : `システムアップデートのお知らせ（v${version}）`;

        const color = isFix ? 0xF1C40F : 0x2ECC71; // 修正なら黄、アップデートなら緑

        const bodyContent = latestSection.replace(/^## .*?\n/, "").trim();

        // 管理ボットAPIへ送信
        const managementUrl = ENV.MANAGEMENT_API_URL;
        const adminToken = ENV.ADMIN_TOKEN;

        if (!managementUrl || !adminToken) {
            console.error("[AutoUpdate] Missing MANAGEMENT_API_URL or ADMIN_TOKEN in env.");
            return;
        }

        const response = await fetch(`${managementUrl}/api/updates/receive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                version,
                title,
                content: bodyContent,
                color,
                token: adminToken
            })
        });

        if (response.ok) {
            console.log(`✅ [AutoUpdate] Automatically notified version ${version} (${title})`);

            // GLOBAL設定に通知済みバージョンを記録
            if (globalRes.rows.length > 0) {
                await dbQuery(
                    "UPDATE settings SET last_notified_version = $1 WHERE guild_id = 'GLOBAL'",
                    [version]
                );
            } else {
                await dbQuery(
                    "INSERT INTO settings (guild_id, last_notified_version) VALUES ('GLOBAL', $1)",
                    [version]
                );
            }
        } else {
            const err = await response.json().catch(() => ({}));
            console.error(`❌ [AutoUpdate] API failed: ${err.error || response.statusText}`);
        }
    } catch (e) {
        console.error("[AutoUpdate] Error:", e.message);
    }
}
