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
                const channelId = settings.mod_log_channel_id;
                if (channelId) {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel) {
                        await channel.send({
                            content: `🚨 **サーバー破壊対策作動** 🚨\n<@${userId}> (\`${userId}\`) が短時間に複数の破壊的アクションを実行したため、付与されているロールを全て剥奪しました。`
                        }).catch(() => {});
                    }
                }
                
                return true;
            }
        } catch (error) {
            console.error(`[Anti-Nuke ERROR] ${error.message}`);
        }
    }
    return false;
}
