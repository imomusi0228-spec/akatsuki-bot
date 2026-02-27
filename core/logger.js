import { EmbedBuilder } from "discord.js";
import { dbQuery } from "./db.js";

/**
 * 共通ログ投稿関数
 * @param {import("discord.js").Guild} guild 
 * @param {'vc' | 'ng' | 'vc_in' | 'vc_out'} type ログの種類
 * @param {import("discord.js").EmbedBuilder | { embeds: any[], files: any[] }} payload 投稿するEmbedまたはメッセージペイロード
 * @param {Date | number} [date] ログの日付（指定がない場合は現在時刻）
 * @param {{ checkDuplicate?: boolean }} [options] オプション
 */
export async function sendLog(guild, type, payload, date = new Date(), options = {}) {
    try {
        const settingsRes = await dbQuery("SELECT log_channel_id, ng_log_channel_id, mod_log_channel_id, color_log, color_ng, color_vc_join, color_vc_leave, branding_footer_text FROM settings WHERE guild_id = $1", [guild.id]);
        const settings = settingsRes.rows[0];
        if (!settings) return;

        let selectedColor = settings.color_log;
        if (type === 'ng') selectedColor = settings.color_ng;
        if (type === 'vc_in') selectedColor = settings.color_vc_join;
        if (type === 'vc_out') selectedColor = settings.color_vc_leave;

        const customColor = selectedColor ? parseInt(selectedColor.replace('#', ''), 16) : null;
        const footerText = settings.branding_footer_text;

        // 種別に応じてログチャンネルを選択
        let channelId;
        if (type === 'mod') {
            channelId = settings.mod_log_channel_id || settings.ng_log_channel_id || settings.log_channel_id;
        } else if (type.startsWith('vc')) {
            channelId = settings.log_channel_id;
        } else {
            channelId = settings.ng_log_channel_id || settings.log_channel_id;
        }

        if (!channelId) return;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased()) return;

        // ペイロード正規化
        const finalPayload = payload.embeds ? payload : { embeds: [payload] };
        const embed = finalPayload.embeds[0];

        if (customColor && embed && typeof embed.setColor === 'function') {
            embed.setColor(customColor);
        }

        if (footerText && embed && typeof embed.setFooter === 'function') {
            embed.setFooter({ text: footerText });
        }

        if (type.startsWith('vc')) {
            // VCログはスレッド化
            const isOut = type === 'vc_out';
            const prefix = isOut ? "退室" : "入室";

            // 日付処理
            const dateObj = new Date(date);
            if (isNaN(dateObj.getTime())) return;

            const dateStr = dateObj.toISOString().split("T")[0];
            const threadName = `${prefix}-${dateStr}`;

            let thread = channel.threads.cache.find(t => t.name === threadName && !t.archived);

            if (!thread) {
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
                        thread = await channel.threads.create({
                            name: threadName,
                            autoArchiveDuration: 1440,
                            reason: `VC ${prefix} Log Thread for ${dateStr}`,
                        }).catch(() => null);
                    } else if (thread.archived) {
                        await thread.setArchived(false);
                    }
                } catch (e) {
                    console.error("Thread Fetch Error:", e);
                }
            }

            if (thread) {
                // 重複チェック
                if (options.checkDuplicate) {
                    const messages = await thread.messages.fetch({ limit: 100 }).catch(() => null);
                    if (messages && embed) {
                        const isDuplicate = messages.some(msg => {
                            if (msg.embeds.length === 0) return false;
                            const e = msg.embeds[0];
                            const sameAuthor = e.author?.name === embed.data.author?.name;
                            const sameDesc = e.description === embed.data.description;
                            const sameFooter = e.footer?.text === embed.data.footer?.text;
                            const targetTime = embed.data.timestamp ? new Date(embed.data.timestamp).getTime() : null;
                            const msgTime = e.timestamp ? new Date(e.timestamp).getTime() : null;
                            const sameTime = targetTime && msgTime && Math.floor(targetTime / 1000) === Math.floor(msgTime / 1000);
                            return sameAuthor && sameDesc && sameTime && sameFooter;
                        });
                        if (isDuplicate) return;
                    }
                }
                await thread.send(finalPayload).catch(() => null);
            } else {
                await channel.send(finalPayload).catch(() => null);
            }
        } else {
            // NGワードログは直接投稿
            if (options.checkDuplicate && embed) {
                const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
                if (messages) {
                    const isDuplicate = messages.some(msg => {
                        if (msg.embeds.length === 0) return false;
                        const e = msg.embeds[0];
                        const sameDesc = e.description === embed.data.description;
                        const sameFooter = e.footer?.text === embed.data.footer?.text;
                        const targetTime = embed.data.timestamp ? new Date(embed.data.timestamp).getTime() : null;
                        const msgTime = e.timestamp ? new Date(e.timestamp).getTime() : null;
                        const sameTime = targetTime && msgTime && Math.floor(targetTime / 1000) === Math.floor(msgTime / 1000);
                        return sameDesc && sameTime && sameFooter;
                    });
                    if (isDuplicate) return;
                }
            }
            await channel.send(finalPayload).catch(() => null);
        }
    } catch (e) {
        console.error(`[LOGGER ERROR] Failed to send ${type} log:`, e.message);
    }
}
