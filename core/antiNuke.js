import { AuditLogEvent } from "discord.js";
import { cache } from "./cache.js";

const antiNukeCache = new Map();

const DESTRUCTIVE_ACTIONS = [
    AuditLogEvent.MemberBanAdd,
    AuditLogEvent.MemberKick,
    AuditLogEvent.ChannelDelete,
    AuditLogEvent.RoleDelete,
    AuditLogEvent.GuildUpdate,
    AuditLogEvent.BotAdd,
    AuditLogEvent.WebhookCreate
];

const ACTION_MAP = {
    [AuditLogEvent.MemberBanAdd]: "ban",
    [AuditLogEvent.MemberKick]: "kick",
    [AuditLogEvent.ChannelDelete]: "channel_delete",
    [AuditLogEvent.RoleDelete]: "role_delete",
    [AuditLogEvent.GuildUpdate]: "guild_update",
    [AuditLogEvent.BotAdd]: "bot_add",
    [AuditLogEvent.WebhookCreate]: "webhook_create"
};

/**
 * サーバー破壊対策モジュール (Anti-Nuke)
 * 指定時間内に一定回数以上の破壊的アクションを行ったユーザーから権限を剥奪する。
 */
export async function checkAntiNuke(guild, entry) {
    const actionKey = ACTION_MAP[entry.action];
    if (!actionKey) return false;

    // Bot自身のアクションは無視
    if (entry.executor.id === guild.client.user.id) return false;

    const guildId = guild.id;
    const userId = entry.executor.id;

    // 設定チェック
    let settings = cache.getSettings(guildId) || {};
    if (!settings.antiraid_enabled) return false;

    // 特定のアクションが有効かチェック
    const flags = settings.antinuke_flags || {};
    if (flags[actionKey] === false) return false;

    const threshold = 5; // 5回
    const timeWindow = 10000; // 10秒

    if (!antiNukeCache.has(guildId)) {
        antiNukeCache.set(guildId, new Map());
    }

    const guildCache = antiNukeCache.get(guildId);
    const now = Date.now();

    if (!guildCache.has(userId)) {
        guildCache.set(userId, []);
    }

    const userActions = guildCache.get(userId);
    userActions.push(now);

    // 古い履歴を削除
    const recentActions = userActions.filter(timestamp => now - timestamp < timeWindow);
    guildCache.set(userId, recentActions);

    if (recentActions.length >= threshold) {
        // サーバー破壊と判定
        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) {
                // 危険な権限を剥奪 (ロールを全て外すか、タイムアウト)
                // 万が一オーナーだった場合は何もしない(APIエラーになるため)
                if (guild.ownerId === userId) return false;

                // 全てのロールを外す
                const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id && role.managed === false);
                await member.roles.remove(rolesToRemove, "サーバー破壊対策 (Anti-Nuke): 連続した破壊的アクションを検知");

                console.log(`[Anti-Nuke] ${guild.name} にて ${entry.executor.tag} の権限を剥奪しました。`);
                
                // ログチャンネルに通知
                const alertMessage = `🚨 **サーバー破壊対策作動** 🚨\nサーバー「${guild.name}」にて、<@${userId}> (${entry.executor.tag}) が短時間に複数の破壊的アクションを実行したため、付与されているロールを全て剥奪しました。`;
                
                const channelId = settings.mod_log_channel_id;
                if (channelId) {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel) {
                        await channel.send({ content: alertMessage }).catch(() => {});
                    }
                }

                // オーナーにDMで通知
                try {
                    const owner = await guild.fetchOwner();
                    if (owner) {
                        await owner.send({
                            content: `⚠️ **【重要】緊急防衛アラート** ⚠️\n\nお嬢、大変ですわ！サーバー「${guild.name}」で破壊行為と思われる動きを検知したため、緊急措置として実行者の権限を剥奪しました。\n\n**詳細:**\n- 実行者: <@${userId}> (${entry.executor.tag})\n- 内容: 短時間での連続した破壊的アクション\n- 措置: 全ロールの剥奪\n\n至急、サーバーの状況をご確認くださいませ。`
                        }).catch(() => console.log(`[Anti-Nuke] Owner DM failed for ${guild.name}`));
                    }
                } catch (e) {
                    console.error("[Anti-Nuke] Failed to fetch owner for DM:", e.message);
                }
                
                return true;
            }
        } catch (error) {
            console.error(`[Anti-Nuke ERROR] ${error.message}`);
        }
    }
    return false;
}
