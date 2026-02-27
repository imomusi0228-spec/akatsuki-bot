import { Events, EmbedBuilder, AuditLogEvent } from "discord.js";
import { dbQuery } from "../core/db.js";
import { cache } from "../core/cache.js";

// B-8: モデレーションログ強化
export default {
    name: Events.GuildAuditLogEntryCreate,
    async default(entry, guild) {
        try {
            let settings = cache.getSettings(guild.id);
            if (!settings) {
                const r = await dbQuery("SELECT mod_log_channel_id, mod_log_flags FROM settings WHERE guild_id = $1", [guild.id]);
                settings = r.rows[0] || {};
                cache.setSettings(guild.id, settings);
            }

            const channelId = settings.mod_log_channel_id;
            if (!channelId) return;

            const flags = settings.mod_log_flags || {};

            const channel = guild.channels.cache.get(channelId);
            if (!channel) return;

            const executor = entry.executor;
            const target = entry.target;

            let shouldLog = false;
            let title = "";
            let color = 0x5865F2;
            let fields = [];

            switch (entry.action) {
                case AuditLogEvent.MemberBanAdd:
                    if (flags.ban) { shouldLog = true; title = "🔨 BAN"; color = 0xFF0000; }
                    break;
                case AuditLogEvent.MemberKick:
                    if (flags.kick) { shouldLog = true; title = "👢 キック"; color = 0xFF6600; }
                    break;
                case AuditLogEvent.MemberRoleUpdate:
                    // Role add or remove
                    const added = entry.changes?.find(c => c.key === '$add');
                    const removed = entry.changes?.find(c => c.key === '$remove');
                    if (added?.new?.length && flags.role_add) {
                        shouldLog = true;
                        title = "✅ ロール付与";
                        color = 0x00BA7C;
                        fields.push({ name: "付与されたロール", value: added.new.map(r => r.name).join(", ") });
                    } else if (removed?.new?.length && flags.role_remove) {
                        shouldLog = true;
                        title = "❌ ロール剥奪";
                        color = 0xFFAA00;
                        fields.push({ name: "剥奪されたロール", value: removed.new.map(r => r.name).join(", ") });
                    }
                    break;
                case AuditLogEvent.ChannelCreate:
                    if (flags.channel_create) { shouldLog = true; title = "📂 チャンネル作成"; color = 0x00BA7C; }
                    break;
                case AuditLogEvent.ChannelDelete:
                    if (flags.channel_delete) { shouldLog = true; title = "🗑️ チャンネル削除"; color = 0xFF0000; }
                    break;
                case AuditLogEvent.MessageUpdate:
                    if (flags.message_edit) { shouldLog = true; title = "✏️ メッセージ編集"; color = 0xFFD700; }
                    break;
                case AuditLogEvent.MessageDelete:
                    if (flags.message_delete) { shouldLog = true; title = "🗑️ メッセージ削除"; color = 0xFF6600; }
                    break;
                default:
                    return;
            }

            if (!shouldLog) return;

            const embed = new EmbedBuilder()
                .setTitle(`📋 Mod Log: ${title}`)
                .setColor(color)
                .addFields(
                    { name: "実行者", value: executor ? `<@${executor.id}> (${executor.tag})` : "不明", inline: true },
                    { name: "対象", value: target?.id ? `<@${target.id}>` : (target?.name || "不明"), inline: true },
                    { name: "理由", value: entry.reason || "理由なし", inline: false },
                    ...fields
                )
                .setTimestamp();

            await channel.send({ embeds: [embed] }).catch(() => { });
        } catch (e) {
            console.error("[B-8 ModLog] Error:", e.message);
        }
    }
};
