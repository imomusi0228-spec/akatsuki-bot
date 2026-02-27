import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { batcher } from "../core/batcher.js";
import { cache } from "../core/cache.js";

export default {
    name: Events.GuildMemberRemove,
    async default(member) {
        if (member.user.bot) return;

        try {
            // Batched Insert
            batcher.push('member_events', { guild_id: member.guild.id, user_id: member.user.id, event_type: 'leave' });
            console.log(`[EVENT] Member Left: ${member.user.tag} from ${member.guild.name}`);
        } catch (e) {
            console.error("[EVENT ERROR] GuildMemberRemove:", e.message);
        }

        // A-3: サーバー退出メッセージ
        try {
            let settings = cache.getSettings(member.guild.id);
            if (!settings) {
                const r = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [member.guild.id]);
                settings = r.rows[0] || {};
                cache.setSettings(member.guild.id, settings);
            }
            if (settings.farewell_enabled && settings.farewell_channel_id) {
                const channel = member.guild.channels.cache.get(settings.farewell_channel_id);
                if (channel) {
                    const tmpl = settings.farewell_message || "🚪 {username} さんが退出しました。";
                    const msg = tmpl
                        .replace(/{user}/g, `<@${member.id}>`)
                        .replace(/{username}/g, member.user.username)
                        .replace(/{server}/g, member.guild.name)
                        .replace(/{count}/g, String(member.guild.memberCount));
                    await channel.send(msg).catch(() => { });
                }
            }
        } catch (e) {
            console.error("[A-3 Farewell] Error:", e.message);
        }
    },
};
