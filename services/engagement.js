import { EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { runAtmosphereCheck } from "./ai_moderator.js";

/**
 * VCエンゲージメント・チェック
 * 1. 期限が来たサーバーへのランキングレポート送信
 * 2. 設定されたしきい値に基づくロールの自動付け外し
 */
export async function runEngagementCheck() {
    console.log("[ENGAGEMENT] Starting high-scale background check...");
    const CHUNK_SIZE = 100;
    const CONCURRENCY = 10;
    let offset = 0;

    while (true) {
        const guildsRes = await dbQuery("SELECT * FROM settings LIMIT $1 OFFSET $2", [CHUNK_SIZE, offset]);
        if (guildsRes.rows.length === 0) break;

        const rows = guildsRes.rows;
        for (let i = 0; i < rows.length; i += CONCURRENCY) {
            const batch = rows.slice(i, i + CONCURRENCY);
            await Promise.all(batch.map(async (settings) => {
                try {
                    const guild = client.guilds.cache.get(settings.guild_id) || await client.guilds.fetch(settings.guild_id).catch(() => null);
                    if (!guild) return;

                    // Execute checks for each guild
                    await processVCReport(guild, settings);
                    await processVCRoles(guild, settings);
                    await processAIAdvice(guild, settings);
                    await runAtmosphereCheck(guild, settings);
                } catch (e) {
                    console.error(`[ENGAGEMENT ERROR] Guild ${settings.guild_id}:`, e.message);
                }
            }));
        }

        offset += CHUNK_SIZE;
        if (rows.length < CHUNK_SIZE) break;
    }
    console.log("[ENGAGEMENT] Finished all guild checks.");
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

    const embedColor = settings.color_log ? parseInt(settings.color_log.replace('#', ''), 16) : 0x1DA1F2;
    const footerText = "Akatsuki Engagement Report";

    const embed = new EmbedBuilder()
        .setTitle(`📊 VC活動ランキング (${periodText})`)
        .setColor(embedColor)
        .setDescription(res.rows.map((r, i) => `${i + 1}. <@${r.user_id}>: **${(r.total / 3600).toFixed(1)}** 時間`).join('\n'))
        .setFooter({ text: footerText })
        .setTimestamp();

    const channel = await guild.channels.fetch(settings.vc_report_channel_id).catch(() => null);
    if (channel) {
        await channel.send({ embeds: [embed] });
        await dbQuery("UPDATE settings SET vc_report_last_sent = NOW() WHERE guild_id = $1", [guild.id]);
        console.log(`[ENGAGEMENT] Report sent for ${guild.name}`);
    }
}

async function processVCRoles(guild, settings) {
    const rules = settings.vc_role_rules;
    if (!rules || !Array.isArray(rules) || rules.length === 0) return;

    const vcRules = rules.filter(r => !r.trigger || r.trigger === 'vc_hours');
    if (vcRules.length === 0) return;

    const roleIds = vcRules.map(r => r.role_id);
    const minHours = Math.min(...vcRules.map(r => r.hours));

    // 1. Find potential members from DB (those who meet at least the minimum threshold)
    const potentialRes = await dbQuery(`
        SELECT user_id, total_vc_minutes
        FROM member_stats
        WHERE guild_id = $1 AND total_vc_minutes >= $2
    `, [guild.id, minHours * 60]);

    // 2. Find currently assigned members to check for removal
    // Note: In high scale, it's better to only check those who HAVE the roles
    const membersWithRoles = await guild.members.fetch({ force: false }).catch(() => null);
    // fetch() without query returns cached members. For high precision in role removal, we might need specific logic.
    // However, to keep it fast, we rely on the DB list + current cache.

    const targetUserIds = new Set(potentialRes.rows.map(r => r.user_id));

    // Add users who currently have the roles in the guild
    roleIds.forEach(roleId => {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            role.members.forEach(m => targetUserIds.add(m.id));
        }
    });

    if (targetUserIds.size === 0) return;

    // 3. Batch fetch only necessary members
    const members = await guild.members.fetch({ user: Array.from(targetUserIds) }).catch(() => new Map());

    const stats = {};
    potentialRes.rows.forEach(r => stats[r.user_id] = r.total_vc_minutes / 60);

    const sortedRules = [...vcRules].sort((a, b) => b.hours - a.hours);

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
        for (const rule of vcRules) {
            const hasRole = member.roles.cache.has(rule.role_id);
            if (targetRule && rule.role_id === targetRule.role_id) {
                if (!hasRole) {
                    await member.roles.add(rule.role_id, "Aura System: Automated assignment").catch(() => null);
                }
            } else {
                if (hasRole) {
                    await member.roles.remove(rule.role_id, "Aura System: Automated removal").catch(() => null);
                }
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

    const advicePromises = res.rows.map(async (row) => {
        try {
            const member = guild.members.cache.get(row.user_id) || await guild.members.fetch(row.user_id).catch(() => null);
            if (!member || member.user.bot) return;

            const lastAct = new Date(row.last_activity_at).toLocaleDateString();

            const advice = `【AIコミュニティ・ヘルス・レポート】
${member.displayName}様は、${lastAct}以降活動が確認できておりません。
累計VC時間は計${Math.floor(row.total_vc_minutes / 60)}時間となっております。
もしよろしければ、最近の近況を伺うようなメッセージをお送りしてみてはいかがでしょうか。
温かいお声掛けが、再会のきっかけになるかもしれません。`;

            const footerText = "Akatsuki Community Health Radar";
            const embed = new EmbedBuilder()
                .setTitle("🛡️ メンバーケア・アドバイス")
                .setDescription(advice)
                .setColor(0x00AE86)
                .setThumbnail(member.user.displayAvatarURL())
                .setFooter({ text: footerText })
                .setTimestamp();

            await channel.send({ embeds: [embed] });

            await dbQuery("UPDATE member_stats SET last_activity_at = NOW() WHERE guild_id = $1 AND user_id = $2", [guild.id, row.user_id]);
        } catch (e) {
            console.error("[AI ADVICE ERROR]:", e.message);
        }
    });

    await Promise.all(advicePromises);
}

