import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";

/**
 * 自己紹介ゲート: 参加後 intro_reminder_hours 経過しても未投稿のメンバーにDMを送信
 */
export async function runIntroReminder() {
    console.log("[INTRO-REMINDER] Checking for members without self-intro...");

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

            // intro_channel でメッセージを送っていない（= roleがない）メンバーのうち
            // 参加から reminderHours 時間以上経過したもの
            const members = await guild.members.fetch();
            for (const [memberId, member] of members) {
                if (member.user.bot) continue;
                if (member.roles.cache.has(roleId)) continue; // 既に紹介済み

                const joinedAt = member.joinedAt;
                if (!joinedAt) continue;

                const hoursSinceJoin = (Date.now() - joinedAt.getTime()) / (1000 * 60 * 60);
                if (hoursSinceJoin < reminderHours) continue;

                // DBで既にリマインダー送信済みかチェック
                const alreadySent = await dbQuery(
                    "SELECT 1 FROM member_stats WHERE guild_id = $1 AND user_id = $2 AND intro_reminded = TRUE",
                    [settings.guild_id, memberId]
                );
                if (alreadySent.rows.length > 0) continue;

                // DM送信
                try {
                    await member.user.send(
                        `👋 **${guild.name}** へようこそ！\n\n` +
                        `서버에 참가하신 지 ${reminderHours}時間以上が経ちましたが、まだ自己紹介が確認できていません。\n` +
                        `<#${settings.intro_channel_id}> チャンネルにて自己紹介を投稿していただけると、サーバーの全機能をご利用いただけます。\n\n` +
                        `*このメッセージはシステムから自動送信されました。*`
                    );
                    console.log(`[INTRO-REMINDER] DM sent to ${member.user.tag} in ${guild.name}`);
                } catch (_) { /* DM拒否は無視 */ }

                // 送信済みフラグを更新
                await dbQuery(
                    "INSERT INTO member_stats (guild_id, user_id, intro_reminded) VALUES ($1, $2, TRUE) ON CONFLICT (guild_id, user_id) DO UPDATE SET intro_reminded = TRUE",
                    [settings.guild_id, memberId]
                );
            }
        } catch (e) {
            console.error(`[INTRO-REMINDER ERROR] Guild ${settings.guild_id}:`, e.message);
        }
    }
}
