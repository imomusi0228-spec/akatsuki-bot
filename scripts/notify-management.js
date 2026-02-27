import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

async function notify() {
    try {
        const logPath = path.join(process.cwd(), "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        // ## v2.x.x (日付) - タイトル 形式で最新セクションを抽出
        // ヘッダー行のパターン: ## vX.X.X
        const sectionRegex = /^(## v(\d+\.\d+\.\d+)[\s\S]*?)(?=\n## v|\n# |$)/m;
        const match = content.match(sectionRegex);

        if (!match) {
            console.error("❌ UPDATE_LOG.md に ## vX.X.X 形式のエントリが見つかりませんでした。");
            process.exit(1);
        }

        const latestSection = match[1].trim();
        const version = match[2]; // "2.9.0"

        // タイトル行（## v2.9.0 (日付) - タイトル）を抽出
        const titleLineMatch = latestSection.match(/^## (v[\d.]+ .*?)$/m);
        const title = titleLineMatch ? titleLineMatch[1] : `v${version}`;

        // タイトル行を除いた本文
        const bodyContent = latestSection.replace(/^## .*?\n/, "").trim();

        console.log(`📦 最新バージョン: ${version}`);
        console.log(`📋 タイトル: ${title}`);
        console.log("---");
        console.log(bodyContent.substring(0, 200) + "...");
        console.log("---");

        const managementUrl = process.env.MANAGEMENT_API_URL || "http://localhost:3000";
        const adminToken = process.env.ADMIN_TOKEN;

        if (!adminToken) {
            console.error("❌ .env に ADMIN_TOKEN が設定されていません。");
            process.exit(1);
        }

        const response = await fetch(`${managementUrl}/api/updates/receive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                version,
                title,
                content: bodyContent,
                token: adminToken
            })
        });

        const result = await response.json();
        if (response.ok) {
            console.log(`✅ 成功: ${result.message}`);
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
