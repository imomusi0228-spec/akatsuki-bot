import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";

/**
 * 自己紹介ゲート: 参加後 intro_reminder_hours 経過しても未投稿のメンバーにDMを送信
 */
export async function runIntroReminder() {
    // console.log("[INTRO-REMINDER] Checking...");

    const guildsRes = await dbQuery(
        "SELECT * FROM settings WHERE self_intro_enabled = TRUE AND intro_channel_id IS NOT NULL AND self_intro_role_id IS NOT NULL"
    );

    for (const settings of guildsRes.rows) {
        try {
            const tier = await getTier(settings.guild_id);
            const features = getFeatures(tier);
            if (!features.introGate) continue;

            const guild = await client.guilds.fetch(settings.guild_id).catch(() => null);
            if (!guild) continue;

            const reminderHours = settings.intro_reminder_hours || 24;
            const roleId = settings.self_intro_role_id;

            // 1. Get recent joins from DB (last 7 days to avoid checking ancient users)
            const recentRes = await dbQuery(
                `SELECT user_id, created_at FROM member_events 
                 WHERE guild_id = $1 AND event_type = 'join' 
                 AND created_at < NOW() - ($2 || ' hours')::INTERVAL
                 AND created_at > NOW() - INTERVAL '7 days'`,
                [settings.guild_id, reminderHours]
            );

            for (const row of recentRes.rows) {
                const memberId = row.user_id;

                // 2. Check if already reminded
                const alreadySent = await dbQuery(
                    "SELECT 1 FROM member_stats WHERE guild_id = $1 AND user_id = $2 AND intro_reminded = TRUE",
                    [settings.guild_id, memberId]
                );
                if (alreadySent.rows.length > 0) continue;

                const member = await guild.members.fetch(memberId).catch(() => null);
                if (!member || member.user.bot) continue;

                // 3. Check role
                if (member.roles.cache.has(roleId)) continue;

                // DM送信
                try {
                    await member.user.send(
                        `👋 **${guild.name}** へようこそ！\n\n` +
                        `サーバーに参加されてから${reminderHours}時間以上が経ちましたが、まだ自己紹介が確認できていません。\n` +
                        `<#${settings.intro_channel_id}> チャンネルにて自己紹介を投稿していただけると、サーバーの全機能をご利用いただけます。\n\n` +
                        `*このメッセージはシステムから自動送信されました。*`
                    );
                    console.log(`[INTRO-REMINDER] DM sent to ${member.user.tag} in ${guild.name}`);
                } catch (_) { /* DM拒否は無視 */ }

                // 送信済みフラグを更新
                await dbQuery(
                    `INSERT INTO member_stats (guild_id, user_id, intro_reminded, last_activity_at) 
                     VALUES ($1, $2, TRUE, NOW()) 
                     ON CONFLICT (guild_id, user_id) DO UPDATE SET intro_reminded = TRUE`,
                    [settings.guild_id, memberId]
                );
            }
        } catch (e) {
            console.error(`[INTRO-REMINDER ERROR] Guild ${settings.guild_id}:`, e.message);
        }
    }
}
