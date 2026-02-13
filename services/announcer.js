import fs from "node:fs/promises";
import path from "node:path";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { EmbedBuilder } from "discord.js";

/**
 * Run weekly checks for auto-unlock and broadcasts
 * Called from index.js intervals
 */
export async function runAnnouncerCheck() {
    console.log("[ANNOUNCER] Running background check...");

    // processUpdateBroadcast() は全サーバーに送信されるため、
    // ユーザーの要望により管理Botからの手動告知システムに移行しました。
    // await processUpdateBroadcast();
}

/**
 * Read UPDATE_LOG.md and broadcast new versions
 */
async function processUpdateBroadcast() {
    try {
        const logPath = path.join(process.cwd(), "UPDATE_LOG.md");
        const content = await fs.readFile(logPath, "utf-8");

        // Basic parser for "## vX.X.X"
        const matches = content.match(/## v(\d+\.\d+\.\d+)[\s\S]+?(?=## v|$)/g);
        if (!matches) return;

        const latestMatch = matches[0];
        const versionMatch = latestMatch.match(/v(\d+\.\d+\.\d+)/);
        if (!versionMatch) return;

        const latestVersion = versionMatch[1];

        // Find guilds that haven't received this version yet
        const settingsRes = await dbQuery("SELECT * FROM settings WHERE last_announced_version IS DISTINCT FROM $1 AND log_channel_id IS NOT NULL", [latestVersion]);

        if (settingsRes.rows.length === 0) return;

        console.log(`[BROADCAST] Sending version ${latestVersion} to ${settingsRes.rows.length} guilds...`);

        const embed = new EmbedBuilder()
            .setTitle(`【告知】システムアップデート (v${latestVersion})`)
            .setDescription(latestMatch.replace(/## v\d+\.\d+\.\d+.*?\n/, "").trim().substring(0, 4000)) // Trim to Discord limit
            .setColor(0x1DA1F2)
            .setTimestamp()
            .setFooter({ text: "Akatsuki Bot Evolution" });

        for (const settings of settingsRes.rows) {
            try {
                const channel = await client.channels.fetch(settings.log_channel_id).catch(() => null);
                if (channel && channel.isTextBased()) {
                    await channel.send({ embeds: [embed] });
                    await dbQuery("UPDATE settings SET last_announced_version = $1 WHERE guild_id = $2", [latestVersion, settings.guild_id]);
                }
            } catch (e) {
                console.error(`[BROADCAST ERROR] Guild ${settings.guild_id}:`, e.message);
            }
        }
    } catch (e) {
        console.error("[ANNOUNCER ERROR] Broadcast failed:", e.message);
    }
}
