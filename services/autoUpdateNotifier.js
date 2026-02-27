import fs from "node:fs/promises";
import path from "node:path";
import { dbQuery } from "../core/db.js";
import { getSafeGuild } from "../core/client.js";
import { EmbedBuilder } from "discord.js";

/**
 * 起動時に UPDATE_LOG.md をチェックし、未通知の新バージョンがあれば全ギルドへ通知する
 */
export async function runAutoUpdateCheck() {
    try {
        const logPath = path.join(process.cwd(), "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        // ## v2.x.x 形式で最新セクションを抽出
        const sectionRegex = /^(## v(\d+\.\d+\.\d+)[\s\S]*?)(?=\n## v|\n# |$)/m;
        const match = content.match(sectionRegex);
        if (!match) return;

        const latestSection = match[1].trim();
        const version = match[2];

        const titleLineMatch = latestSection.match(/^## (v[\d.]+ .*?)$/m);
        const title = titleLineMatch ? titleLineMatch[1] : `v${version}`;
        const bodyContent = latestSection.replace(/^## .*?\n/, "").trim();

        // お知らせ設定がある全ギルドを取得
        const settingsRes = await dbQuery(
            "SELECT guild_id, update_announce_channel_id, last_notified_version FROM settings WHERE update_announce_channel_id IS NOT NULL AND update_announce_channel_id != ''",
            []
        );

        let notifiedCount = 0;
        for (const row of settingsRes.rows) {
            // 既にこのバージョンを通知済みならスキップ
            if (row.last_notified_version === version) continue;

            const guild = await getSafeGuild(row.guild_id);
            if (!guild) continue;

            const channel = guild.channels.cache.get(row.update_announce_channel_id);
            if (!channel) continue;

            const embed = new EmbedBuilder()
                .setTitle(`🌟 Akatsuki Bot アップデート — ${title}`)
                .setDescription(bodyContent || "詳細は更新履歴をご確認ください。")
                .setColor(0x00BA7C)
                .setFooter({ text: `バージョン ${version}` })
                .setTimestamp();

            await channel.send({ embeds: [embed] }).catch(() => { });

            // DB更新
            await dbQuery(
                "UPDATE settings SET last_notified_version = $1 WHERE guild_id = $2",
                [version, row.guild_id]
            );
            notifiedCount++;
        }

        if (notifiedCount > 0) {
            console.log(`[AutoUpdate] Notified ${notifiedCount} guild(s) about version ${version}`);
        }
    } catch (e) {
        console.error("[AutoUpdate] Error:", e.message);
    }
}
