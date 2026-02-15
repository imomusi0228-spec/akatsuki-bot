import { EmbedBuilder } from "discord.js";
import { dbQuery } from "./db.js";

/**
 * 共通ログ投稿関数
 * @param {import("discord.js").Guild} guild 
 * @param {'vc' | 'ng' | 'vc_in' | 'vc_out'} type ログの種類
 * @param {import("discord.js").EmbedBuilder} embed 投稿するEmbed
 * @param {Date | number} [date] ログの日付（指定がない場合は現在時刻）
 * @param {{ checkDuplicate?: boolean }} [options] オプション
 */
export async function sendLog(guild, type, embed, date = new Date(), options = {}) {
    try {
        const settingsRes = await dbQuery("SELECT log_channel_id, ng_log_channel_id FROM settings WHERE guild_id = $1", [guild.id]);
        const settings = settingsRes.rows[0];
        if (!settings) return;

        // 種別に応じてログチャンネルを選択
        const channelId = type.startsWith('vc') ? settings.log_channel_id : (settings.ng_log_channel_id || settings.log_channel_id);
        if (!channelId) return;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        if (type.startsWith('vc')) {
            // VCログはスレッド化
            const isOut = type === 'vc_out';
            const prefix = isOut ? "退室" : "入室";

            // 日付処理
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) return; // Invalid Date

            const dateStr = dateObj.toISOString().split("T")[0];
            const threadName = `${prefix}-${dateStr}`;

            let thread = channel.threads.cache.find(t => t.name === threadName && !t.archived);

            if (!thread) {
                // アーカイブされているスレッドも検索
                try {
                    const fetchedThreads = await channel.threads.fetchActive();
                    thread = fetchedThreads.threads.find(t => t.name === threadName);

                    if (!thread) {
                        const archivedThreads = await channel.threads.fetchArchived({ type: 'public', limit: 50 }).catch(() => null);
                        if (archivedThreads) {
                            thread = archivedThreads.threads.find(t => t.name === threadName);
                        }
                    }

                    if (!thread) {
                        // 新規作成 (過去の日付でも、スキャン等のために作成)
                        thread = await channel.threads.create({
                            name: threadName,
                            autoArchiveDuration: 1440,
                            reason: `VC ${prefix} Log Thread for ${dateStr}`,
                        }).catch(() => null);
                    } else if (thread.archived) {
                        // アーカイブされていたら復元
                        await thread.setArchived(false);
                    }
                } catch (e) {
                    console.error("Thread Fetch Error:", e);
                }
            }

            if (thread) {
                // 重複チェック
                if (options.checkDuplicate) {
                    // Fetch more messages to ensure we don't duplicate older logs being scanned
                    const messages = await thread.messages.fetch({ limit: 100 }).catch(() => null);
                    if (messages) {
                        const isDuplicate = messages.some(msg => {
                            if (msg.embeds.length === 0) return false;
                            const e = msg.embeds[0];
                            // 著者名, タイトル(なければ説明), タイムスタンプ, フッターが一致するか確認
                            // フッターも含めることで通常ログと復元ログを区別
                            const sameAuthor = e.author?.name === embed.data.author?.name;
                            const sameDesc = e.description === embed.data.description;
                            const sameFooter = e.footer?.text === embed.data.footer?.text;

                            // タイムスタンプ比較 (秒単位で比較、ミリ秒は無視)
                            const targetTime = embed.data.timestamp ? new Date(embed.data.timestamp).getTime() : null;
                            const msgTime = e.timestamp ? new Date(e.timestamp).getTime() : null;
                            const sameTime = targetTime && msgTime && Math.floor(targetTime / 1000) === Math.floor(msgTime / 1000);

                            return sameAuthor && sameDesc && sameTime && sameFooter;
                        });
                        if (isDuplicate) {
                            console.log(`[LOGGER] Duplicate ${type} log skipped for ${embed.data.author?.name}`);
                            return;
                        }
                    }
                }
                await thread.send({ embeds: [embed] }).catch(() => null);
            } else {
                // スレッド作成に失敗した場合は直接送る（フォールバック）
                await channel.send({ embeds: [embed] }).catch(() => null);
            }
        } else {
            // NGワードログは直接投稿
            if (options.checkDuplicate) {
                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (messages) {
                    const isDuplicate = messages.some(msg => {
                        if (msg.embeds.length === 0) return false;
                        const e = msg.embeds[0];
                        const sameDesc = e.description === embed.data.description;
                        const sameFooter = e.footer?.text === embed.data.footer?.text;

                        // タイムスタンプ比較 (秒単位)
                        const targetTime = embed.data.timestamp ? new Date(embed.data.timestamp).getTime() : null;
                        const msgTime = e.timestamp ? new Date(e.timestamp).getTime() : null;
                        const sameTime = targetTime && msgTime && Math.floor(targetTime / 1000) === Math.floor(msgTime / 1000);

                        return sameDesc && sameTime && sameFooter;
                    });
                    if (isDuplicate) {
                        console.log(`[LOGGER] Duplicate ${type} log skipped`);
                        return;
                    }
                }
            }
            await channel.send({ embeds: [embed] }).catch(() => null);
        }
    } catch (e) {
        console.error(`[LOGGER ERROR] Failed to send ${type} log:`, e.message);
    }
}
