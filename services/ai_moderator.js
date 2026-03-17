import { EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";

/**
 * サーバーの「空気」を解析し、予兆があれば警告を送信する
 */
export async function runAtmosphereCheck(guild, settings) {
    if (!settings.ai_prediction_enabled || !settings.ai_predict_channel_id) return;

    const guildId = guild.id;
    const now = new Date();

    // 1. 直近5分間のデータを収集
    const interval = "5 minutes";

    // a. メッセージ密度
    const msgRes = await dbQuery(
        `
        SELECT COUNT(*) as count 
        FROM member_events 
        WHERE guild_id = $1 AND event_type = 'message' AND created_at > NOW() - INTERVAL '${interval}'
    `,
        [guildId]
    ).catch(() => ({ rows: [{ count: 0 }] }));

    // b. NGワード頻度
    const ngRes = await dbQuery(
        `
        SELECT COUNT(*) as count, ARRAY_AGG(DISTINCT word) as words
        FROM ng_logs
        WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '${interval}'
    `,
        [guildId]
    ).catch(() => ({ rows: [{ count: 0, words: [] }] }));

    const msgCount = parseInt(msgRes.rows[0]?.count || 0);
    const ngCount = parseInt(ngRes.rows[0]?.count || 0);
    const ngWords = ngRes.rows[0]?.words || [];

    // 2. 解析ロジック (Heuristic Atmosphere Index)
    let unsettlingFactor = 0;
    let reasons = [];

    // NGワード率が高い場合
    if (msgCount > 0 && ngCount / msgCount > 0.15) {
        unsettlingFactor += 40;
        reasons.push("高いNGワード検知率（暴言・禁止事項の頻発）");
    }

    // メッセージが急増し、NGワードも出ている場合
    if (msgCount > 30 && ngCount >= 2) {
        unsettlingFactor += 30;
        reasons.push("急激なメッセージ増加に伴う不穏な動き");
    }

    // 特定の単語が集中している場合
    if (ngWords.length >= 3) {
        unsettlingFactor += 20;
        reasons.push("複数の禁止ワードが短時間に集中");
    }

    // [New] 離脱の予兆 (短時間のイベント)
    const leaveRes = await dbQuery(
        `SELECT COUNT(*) as count FROM member_events WHERE guild_id = $1 AND event_type = 'leave' AND created_at > NOW() - INTERVAL '30 minutes'`,
        [guildId]
    ).catch(() => ({ rows: [{ count: 0 }] }));
    const leaveCount = parseInt(leaveRes.rows[0]?.count || 0);
    if (leaveCount >= 3) {
        unsettlingFactor += 15;
        reasons.push(`短時間での複数人の離脱検知 (${leaveCount}名)`);
    }

    // 3. アラート送信 (しきい値: 50)
    if (unsettlingFactor >= 50) {
        const channel = await guild.channels
            .fetch(settings.ai_predict_channel_id)
            .catch(() => null);
        if (!channel) return;

        const footerText = settings.branding_footer_text || "Akatsuki AI Atmosphere Monitor";
        const embedColor = settings.color_log
            ? parseInt(settings.color_log.replace("#", ""), 16)
            : 0xffaa00;

        const embed = new EmbedBuilder()
            .setTitle("🧠 AI予兆検知アラート")
            .setDescription(
                `サーバー内で不穏な空気の「予兆」を検知しました。介入の検討をお勧めします。`
            )
            .addFields(
                { name: "不穏指数", value: `**${unsettlingFactor}%**`, inline: true },
                { name: "主な要因", value: reasons.join("\n") || "複合的な要因" },
                {
                    name: "直近5分の状況",
                    value: `メッセージ数: ${msgCount}件 / NG検知: ${ngCount}件`,
                }
            )
            .setColor(embedColor)
            .setFooter({ text: footerText })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        console.log(`[AI-PREDICT] Alert sent for ${guild.name} (Factor: ${unsettlingFactor})`);
    }
}
