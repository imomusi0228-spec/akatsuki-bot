import { EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";

/**
 * VCエンゲージメント・チェック
 * 1. 期限が来たサーバーへのランキングレポート送信
 * 2. 設定されたしきい値に基づくロールの自動付け外し
 */
export async function runEngagementCheck() {
    console.log("[ENGAGEMENT] Running background check...");
    const guildsRes = await dbQuery("SELECT * FROM settings");

    for (const settings of guildsRes.rows) {
        try {
            const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
            if (!guild) continue;

            // 1. レポート送信チェック
            await processVCReport(guild, settings);

            // 2. ロール付与チェック (Aura System)
            await processVCRoles(guild, settings);

            // 3. AIアドバイスチェック (Community Health Radar)
            await processAIAdvice(guild, settings);

        } catch (e) {
            console.error(`[ENGAGEMENT ERROR] Guild ${settings.guild_id}:`, e.message);
        }
    }
}

async function processVCReport(guild, settings) {
    if (!settings.vc_report_enabled || !settings.vc_report_channel_id) return;

    const interval = settings.vc_report_interval || 'weekly';
    const lastSent = settings.vc_report_last_sent ? new Date(settings.vc_report_last_sent) : new Date(0);
    const now = new Date();

    let shouldSend = false;
    let periodText = "";
    let dateFilter = "";

    if (interval === 'daily') {
        shouldSend = (now - lastSent) > 24 * 60 * 60 * 1000;
        periodText = "本日";
        dateFilter = "CURRENT_DATE";
    } else if (interval === 'weekly') {
        shouldSend = (now - lastSent) > 7 * 24 * 60 * 60 * 1000;
        periodText = "今週";
        dateFilter = "date_trunc('week', CURRENT_DATE)";
    } else { // monthly
        shouldSend = (now - lastSent) > 28 * 24 * 60 * 60 * 1000; // Simplified
        periodText = "今月";
        dateFilter = "date_trunc('month', CURRENT_DATE)";
    }

    if (!shouldSend) return;

    // Get Top 10
    const res = await dbQuery(`
        SELECT user_id, SUM(duration_seconds) as total
        FROM vc_sessions
        WHERE guild_id = $1 AND join_time >= ${dateFilter}
        GROUP BY user_id
        ORDER BY total DESC
        LIMIT 10
    `, [guild.id]);

    if (res.rows.length === 0) return;

    const embed = new EmbedBuilder()
        .setTitle(`📊 VC活動ランキング (${periodText})`)
        .setColor(0x1DA1F2)
        .setDescription(res.rows.map((r, i) => `${i + 1}. <@${r.user_id}>: **${(r.total / 3600).toFixed(1)}** 時間`).join('\n'))
        .setFooter({ text: "Akatsuki Engagement Report" })
        .setTimestamp();

    const channel = await guild.channels.fetch(settings.vc_report_channel_id).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [embed] });
        await dbQuery("UPDATE settings SET vc_report_last_sent = NOW() WHERE guild_id = $1", [guild.id]);
        console.log(`[ENGAGEMENT] Report sent for ${guild.name}`);
    }
}

async function processVCRoles(guild, settings) {
    const rules = settings.vc_role_rules; // Array of {hours, role_id, aura_name}
    if (!rules || !Array.isArray(rules) || rules.length === 0) return;

    // Get everyone's total life-time stats from member_stats
    const res = await dbQuery(`
        SELECT user_id, total_vc_minutes
        FROM member_stats
        WHERE guild_id = $1
    `, [guild.id]);

    const stats = {};
    res.rows.forEach(r => stats[r.user_id] = r.total_vc_minutes / 60);

    const sortedRules = [...rules].sort((a, b) => b.hours - a.hours);

    const members = await guild.members.fetch();
    for (const [memberId, member] of members) {
        if (member.user.bot) continue;
        const userHours = stats[memberId] || 0;

        let targetRule = null;
        for (const rule of sortedRules) {
            if (userHours >= rule.hours) {
                targetRule = rule;
                break;
            }
        }

        // Apply / Remove
        for (const rule of rules) {
            const hasRole = member.roles.cache.has(rule.role_id);
            if (targetRule && rule.role_id === targetRule.role_id) {
                if (!hasRole) {
                    await member.roles.add(rule.role_id).catch(() => null);
                    // Optional: Welcome message for new Aura?
                    console.log(`[AURA] ${member.user.tag} received aura: ${rule.aura_name}`);
                }
            } else {
                if (hasRole) await member.roles.remove(rule.role_id).catch(() => null);
            }
        }
    }
}

async function processAIAdvice(guild, settings) {
    if (!settings.ai_advice_channel_id) return;
    const adviceDays = settings.ai_advice_days || 14;

    // Find members who haven't been active for 'adviceDays'
    const res = await dbQuery(`
        SELECT user_id, last_activity_at, total_vc_minutes
        FROM member_stats
        WHERE guild_id = $1 AND last_activity_at < NOW() - ($2 || ' days')::INTERVAL
    `, [guild.id, adviceDays]);

    if (res.rows.length === 0) return;

    const channel = await guild.channels.fetch(settings.ai_advice_channel_id).catch(() => null);
    if (!channel) return;

    for (const row of res.rows) {
        try {
            const member = await guild.members.fetch(row.user_id).catch(() => null);
            if (!member) continue;

            const lastAct = new Date(row.last_activity_at).toLocaleDateString();

            // Generate Advice (Local logic or LLM)
            // For now, simpler template but in a "polite" tone as requested.
            const advice = `【AIコミュニティ・ヘルス・レポート】
${member.displayName}様は、${lastAct}以降活動が確認できておりません。
累計VC時間は計${Math.floor(row.total_vc_minutes / 60)}時間となっております。
もしよろしければ、最近の近況を伺うようなメッセージをお送りしてみてはいかがでしょうか。
温かいお声掛けが、再会のきっかけになるかもしれません。`;

            const embed = new EmbedBuilder()
                .setTitle("🛡️ メンバーケア・アドバイス")
                .setDescription(advice)
                .setColor(0x00AE86)
                .setThumbnail(member.user.displayAvatarURL())
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            // Update last_activity_at to avoid duplicate spam (bump it slightly)
            await dbQuery("UPDATE member_stats SET last_activity_at = NOW() WHERE guild_id = $1 AND user_id = $2", [guild.id, row.user_id]);
        } catch (e) {
            console.error("[AI ADVICE ERROR]:", e.message);
        }
    }
}

