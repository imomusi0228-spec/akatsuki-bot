import { EmbedBuilder, TextChannel } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { getChannelAtmosphere } from "./sentiment.js";
import { applyAIslowmode } from "../core/protection.js";

/**
 * サーバー運営アドバイス（インサイト）の定期配信
 */
export async function runInsightCheck() {
    console.log("[INSIGHT] Running strategic analysis...");
    const guildsRes = await dbQuery(
        "SELECT * FROM settings WHERE ai_insight_enabled = TRUE AND ai_insight_channel_id IS NOT NULL"
    );

    for (const settings of guildsRes.rows) {
        try {
            const lastSent = settings.ai_insight_last_sent
                ? new Date(settings.ai_insight_last_sent)
                : new Date(0);
            const now = new Date();

            // 週に一度（7日間隔）
            if (now - lastSent < 7 * 24 * 60 * 60 * 1000) continue;

            const guild =
                client.guilds.cache.get(settings.guild_id) ||
                (await client.guilds.fetch(settings.guild_id).catch(() => null));
            if (!guild) continue;

            await generateAndSendInsight(guild, settings);
        } catch (e) {
            console.error(`[INSIGHT ERROR] Guild ${settings.guild_id}:`, e.message);
        }
    }
}

async function generateAndSendInsight(guild, settings) {
    const guildId = guild.id;

    // 有効セクションを取得
    const sections = Array.isArray(settings.insight_sections)
        ? settings.insight_sections
        : ["growth", "toxicity", "vc"];

    if (sections.length === 0) return;

    // 1. Data Gathering (Current Week vs Previous Week)
    const queries = [];
    
    // Growth: Current 7 days vs 7-14 days ago
    if (sections.includes("growth")) {
        queries.push(dbQuery(
            `SELECT event_type, COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY event_type`,
            [guildId]
        ));
        queries.push(dbQuery(
            `SELECT event_type, COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days' GROUP BY event_type`,
            [guildId]
        ));
    } else {
        queries.push(Promise.resolve({ rows: [] }), Promise.resolve({ rows: [] }));
    }

    // Toxicity
    if (sections.includes("toxicity")) {
        queries.push(dbQuery(
            `SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
            [guildId]
        ));
        queries.push(dbQuery(
            `SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'`,
            [guildId]
        ));
    } else {
        queries.push(Promise.resolve({ rows: [{ cnt: 0 }] }), Promise.resolve({ rows: [{ cnt: 0 }] }));
    }

    const results = await Promise.all(queries);
    const currGrowth = results[0].rows;
    const prevGrowth = results[1].rows;
    const currTox = parseInt(results[2].rows[0]?.cnt || 0);
    const prevTox = parseInt(results[3].rows[0]?.cnt || 0);

    const joins = parseInt(currGrowth.find(r => r.event_type === 'join')?.cnt || 0);
    const leaves = parseInt(currGrowth.find(r => r.event_type === 'leave')?.cnt || 0);
    const prevJoins = parseInt(prevGrowth.find(r => r.event_type === 'join')?.cnt || 0);

    // 2. Advice & Trends
    let advice = "";
    const fields = [];

    if (sections.includes("growth")) {
        const diff = joins - prevJoins;
        const trendIcon = diff >= 0 ? "📈" : "📉";
        const trendText = diff !== 0 ? ` (先週比 ${diff > 0 ? "+" : ""}${diff}名)` : "";
        
        advice += `${trendIcon} **成長トレンド**: 今週は ${joins}名が参加されました。${trendText}\n`;
        if (leaves > joins) {
            advice += "⚠️ 離脱数が参加数を上回っています。定着率向上の施策（ウェルカムメッセージの見直し等）を推奨します。\n";
        }
        fields.push({ name: "参加 / 離脱", value: `${joins}名 / ${leaves}名`, inline: true });
    }

    if (sections.includes("toxicity")) {
        const toxDiff = currTox - prevTox;
        advice += `🚫 **治安維持**: 禁止ワード検知は ${currTox}件です。${toxDiff > 0 ? `⚠️ 先週より ${toxDiff}件増加しています。` : "✅ 先週より減少しており、良好な状態です。"}\n`;
        fields.push({ name: "警告検-知数", value: `${currTox}件`, inline: true });
    }

    const embed = new EmbedBuilder()
        .setTitle("📊 戦略的サーバー・インサイト報告")
        .setDescription(`今週のサーバー分析レポートが完了しました。以下の内容をご確認ください。\n\n${advice}`)
        .addFields(...fields)
        .setColor("#bb9af7")
        .setFooter({ text: "AkatsukiBot AI Strategy Engine" })
        .setTimestamp();

    const channel = await guild.channels.fetch(settings.ai_insight_channel_id).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [embed] });
        await dbQuery("UPDATE settings SET ai_insight_last_sent = NOW() WHERE guild_id = $1", [guildId]);
    }
}

/**
 * Real-time Atmosphere Analysis and Automatic Alerting
 * Detects negative sentiment and triggers intervention.
 */
export async function analyzeAtmosphereAndAlert(guildId, channelId) {
    const res = await dbQuery(
        "SELECT * FROM settings WHERE guild_id = $1 AND ai_prediction_enabled = TRUE",
        [guildId]
    );
    const settings = res.rows[0];
    if (!settings) return;

    const score = await getChannelAtmosphere(guildId, channelId);
    
    // Threshold: Sentiment score below -0.4 is considered "Heated"
    if (score <= -0.4) {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        const channel = await guild?.channels.fetch(channelId).catch(() => null);
        const alertChannelId = settings.ai_predict_channel_id || settings.ai_insight_channel_id;

        if (guild && channel && alertChannelId) {
            const alertChannel = await guild.channels.fetch(alertChannelId).catch(() => null);
            
            // System-style concise alert message
            const alertEmbed = new EmbedBuilder()
                .setTitle("[SYSTEM] ATMOSPHERE ALERT")
                .setDescription(`Extreme negative sentiment detected in <#${channelId}>.\nScore: ${score.toFixed(2)}`)
                .setColor("#ff5555")
                .setTimestamp();

            if (alertChannel) {
                await alertChannel.send({ embeds: [alertEmbed] });
            }

            // Automatic Intervention (Slowmode)
            // Default to 10s slowmode, 5m restore if not configured
            const slowmodeSeconds = 10;
            const restoreMinutes = settings.ai_slowmode_restore_mins || 5;
            
            await applyAIslowmode(channel, slowmodeSeconds, restoreMinutes);
        }
    }
}
