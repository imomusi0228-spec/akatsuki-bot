import { EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";

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

    // 有効セクションを取得（デフォルト: 全て有効）
    const sections = Array.isArray(settings.insight_sections)
        ? settings.insight_sections
        : ["growth", "toxicity", "vc"];

    // 有効なセクションがゼロなら送信しない
    if (sections.length === 0) {
        console.log(`[INSIGHT] Skipped (no sections enabled): ${guild.name}`);
        return;
    }

    // 1. Data Gathering（必要なデータのみ取得）
    const queries = [];
    if (sections.includes("growth"))
        queries.push(
            dbQuery(
                `SELECT event_type, COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY event_type`,
                [guildId]
            )
        );
    else queries.push(Promise.resolve({ rows: [] }));

    if (sections.includes("toxicity"))
        queries.push(
            dbQuery(
                `SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
                [guildId]
            )
        );
    else queries.push(Promise.resolve({ rows: [{ cnt: 0 }] }));

    if (sections.includes("vc"))
        queries.push(
            dbQuery(
                `SELECT COUNT(DISTINCT user_id) as cnt FROM vc_sessions WHERE guild_id = $1 AND join_time > NOW() - INTERVAL '7 days'`,
                [guildId]
            )
        );
    else queries.push(Promise.resolve({ rows: [{ cnt: 0 }] }));

    const [growthRes, toxicityRes, engageRes] = await Promise.all(queries);

    const joins = parseInt(growthRes.rows.find((r) => r.event_type === "join")?.cnt || 0);
    const leaves = parseInt(growthRes.rows.find((r) => r.event_type === "leave")?.cnt || 0);
    const toxicity = parseInt(toxicityRes.rows[0]?.cnt || 0);
    const activeUsers = parseInt(engageRes.rows[0]?.cnt || 0);

    // 2. Advice Generation（有効セクションのみ）
    let advice = "";
    const fields = [];

    if (sections.includes("growth")) {
        if (joins > leaves * 2) {
            advice +=
                "📈 **成長傾向**: 素晴らしいですね。新規メンバーが順調に増えています。歓迎の挨拶を欠かさないようにしましょう。\n";
        } else if (leaves > joins) {
            advice +=
                "⚠️ **離脱警告**: 最近、参加者よりも離脱者が多くなっています。サーバーのルールや導入手順に分かりにくい点がないか、一度見直してみるのも良いかもしれません。\n";
        } else {
            advice +=
                "↔️ **安定状態**: メンバー数は安定しています。既存のコミュニティをより深める時期かもしれません。\n";
        }
        fields.push({
            name: "直近7日の参加/離脱",
            value: `${joins}名 / ${leaves}名`,
            inline: true,
        });
    }

    if (sections.includes("toxicity")) {
        if (toxicity > 20) {
            advice +=
                "🚫 **秩序の乱れ**: 禁止ワードの検知数が少し多いようです。コミュニティの雰囲気が荒れていないか、注意深く見守ってくださいね。\n";
        }
        fields.push({ name: "警告検知数", value: `${toxicity}件`, inline: true });
    }

    if (sections.includes("vc")) {
        if (activeUsers < guild.memberCount * 0.1) {
            advice +=
                "🎤 **活性化のヒント**: ボイスチャットを利用している方が少し少ないようです。特定の時間帯に「雑談タイム」などを設けてみるのはいかがでしょうか。\n";
        } else {
            advice +=
                "✨ **高い熱量**: 多くの方がアクティブに活動されています。この調子で素敵な場所を守っていきましょう。\n";
        }
        fields.push({ name: "アクティブ(VC)", value: `${activeUsers}名`, inline: true });
    }

    const embed = new EmbedBuilder()
        .setTitle("📊 サーバー運営レポート")
        .setDescription(
            `今週の運営状況を分析しました。今後の運営の参考にしてください。\n\n${advice || "（全セクションが無効です）"}`
        )
        .addFields(...fields)
        .setColor(0x5865f2)
        .setTimestamp();

    const channel = await guild.channels.fetch(settings.ai_insight_channel_id).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [embed] });
        await dbQuery("UPDATE settings SET ai_insight_last_sent = NOW() WHERE guild_id = $1", [
            guildId,
        ]);
        console.log(`[INSIGHT] Report sent to ${guild.name} (sections: ${sections.join(", ")})`);
    }
}
