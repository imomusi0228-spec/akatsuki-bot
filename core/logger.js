import { EmbedBuilder } from "discord.js";
import { dbQuery } from "./db.js";

/**
 * 共通ログ投稿関数
 * @param {import("discord.js").Guild} guild 
 * @param {'vc' | 'ng'} type ログの種類
 * @param {import("discord.js").EmbedBuilder} embed 投稿するEmbed
 */
export async function sendLog(guild, type, embed) {
    try {
        const settingsRes = await dbQuery("SELECT log_channel_id, ng_log_channel_id FROM settings WHERE guild_id = $1", [guild.id]);
        const settings = settingsRes.rows[0];
        if (!settings) return;

        // 種別に応じてログチャンネルを選択
        const channelId = type === 'vc' ? settings.log_channel_id : (settings.ng_log_channel_id || settings.log_channel_id);
        if (!channelId) return;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        if (type === 'vc') {
            // VCログはスレッド化
            const today = new Date().toISOString().split("T")[0];
            let thread = channel.threads.cache.find(t => t.name === today && !t.archived);

            if (!thread) {
                const fetchedThreads = await channel.threads.fetchActive();
                thread = fetchedThreads.threads.find(t => t.name === today);

                if (!thread) {
                    thread = await channel.threads.create({
                        name: today,
                        autoArchiveDuration: 1440,
                        reason: "Daily VC Log Thread",
                    }).catch(() => null);
                }
            }

            if (thread) {
                await thread.send({ embeds: [embed] }).catch(() => null);
            } else {
                // スレッド作成に失敗した場合は直接送る（フォールバック）
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        } else {
            // NGワードログは直接投稿
            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    } catch (e) {
        console.error(`[LOGGER ERROR] Failed to send ${type} log:`, e.message);
    }
}
