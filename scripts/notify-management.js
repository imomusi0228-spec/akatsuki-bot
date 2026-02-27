import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

async function notify() {
    try {
        const args = process.argv.slice(2);
        const atIndex = args.indexOf("--at");
        const syncAll = args.includes("--sync-all");
        let scheduledAt = null;

        const managementUrl = process.env.MANAGEMENT_API_URL || "http://localhost:3000";
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken) {
            console.error("❌ ADMIN_TOKEN が設定されていません。");
            process.exit(1);
        }

        if (atIndex !== -1 && args[atIndex + 1]) {
            const timeStr = args[atIndex + 1]; // "HH:mm"
            const [hours, minutes] = timeStr.split(":").map(Number);
            if (isNaN(hours) || isNaN(minutes)) {
                console.error("❌ 無効な時刻形式です。--at HH:mm の形式で指定してください。");
                process.exit(1);
            }
            const now = new Date();
            const scheduledDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
            if (scheduledDate < now) {
                scheduledDate.setDate(scheduledDate.getDate() + 1);
            }
            scheduledAt = scheduledDate;
            console.log(`⏰ 送信予約時刻: ${scheduledAt.toLocaleString()}`);
        }

        const scriptDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
        const logPath = path.join(scriptDir, "..", "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        if (syncAll) {
            console.log("🧹 チャンネルを初期化し、全履歴を同期します...");

            // サーバー側のリセットAPIを叩く
            const resetRes = await fetch(`${managementUrl}/api/updates/reset`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: adminToken })
            });

            if (!resetRes.ok) {
                const err = await resetRes.json().catch(() => ({}));
                console.error(`❌ リセットに失敗しました: ${err.error || resetRes.statusText}`);
                process.exit(1);
            }
            console.log("✅ チャンネルの初期化が完了しました。");

            // 全セクションを抽出して最古（下）から順に送信
            const sections = content.split(/\n---\n/).filter(s => s.trim().startsWith("## v"));
            const reversedSections = sections.reverse();

            for (const section of reversedSections) {
                const match = section.match(/## v(\d+\.\d+\.\d+)/);
                if (!match) continue;

                const version = match[1];
                const isFix = section.includes("システム修正");
                const title = isFix
                    ? `システム修正のお知らせ（v${version}）`
                    : `システムアップデートのお知らせ（v${version}）`;
                const bodyContent = section.replace(/^## .*?\n/, "").trim();

                console.log(`📡 送信中: ${title}...`);
                await fetch(`${managementUrl}/api/updates/receive`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        version,
                        title,
                        content: bodyContent,
                        color: isFix ? 0xF1C40F : 0x2ECC71,
                        token: adminToken
                    })
                });
                // ボットのレートリミットを考慮して少し待つ
                await new Promise(r => setTimeout(r, 1000));
            }
            console.log("🎉 全履歴の同期が完了しました。");
            return;
        }

        // 通常の単一送信（最新のみ）
        const sectionRegex = /^(## v(\d+\.\d+\.\d+)[\s\S]*?)(?=\n## v|\n# |$)/m;
        const match = content.match(sectionRegex);

        if (!match) {
            console.error("❌ UPDATE_LOG.md にエントリが見つかりませんでした。");
            process.exit(1);
        }

        const latestSection = match[1].trim();
        const version = match[2];
        const isFix = latestSection.includes("システム修正");
        const title = isFix
            ? `システム修正のお知らせ（v${version}）`
            : `システムアップデートのお知らせ（v${version}）`;
        const bodyContent = latestSection.replace(/^## .*?\n/, "").trim();

        console.log(`📦 バージョン: ${version}`);
        console.log(`📋 タイトル: ${title}`);

        const response = await fetch(`${managementUrl}/api/updates/receive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                version,
                title,
                content: bodyContent,
                color: isFix ? 0xF1C40F : 0x2ECC71,
                scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
                token: adminToken
            })
        });

        const result = await response.json();
        if (response.ok) {
            console.log(`✅ ${scheduledAt ? "予約完了" : "送信完了"}: ${result.message}`);
        } else {
            console.error(`❌ 失敗: ${result.error || response.statusText}`);
            process.exit(1);
        }
    } catch (error) {
        console.error("🔥 エラー:", error.message);
        process.exit(1);
    }
}

notify();
