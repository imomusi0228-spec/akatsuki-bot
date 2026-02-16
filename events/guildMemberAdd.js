import { Events } from "discord.js";
import { dbQuery } from "../core/db.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { cache } from "../core/cache.js";
import { batcher } from "../core/batcher.js";

export default {
    name: Events.GuildMemberAdd,
    async default(member) {
        if (member.user.bot) return;

        try {
            // 1. Record Join Event (Batched)
            batcher.push('member_events', { guild_id: member.guild.id, user_id: member.user.id, event_type: 'join' });
            console.log(`[EVENT] Member Joined: ${member.user.tag} in ${member.guild.name}`);

            // 2. Anti-Raid Detection (Pro/Pro+)
            const tier = await getTier(member.guild.id);
            const features = getFeatures(tier);

            if (features.antiraid) {
                let settings = cache.getSettings(member.guild.id);
                if (!settings) {
                    const settingsRes = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [member.guild.id]);
                    settings = settingsRes.rows[0] || {};
                    cache.setSettings(member.guild.id, settings);
                }

                if (settings.antiraid_enabled) {
                    const threshold = settings.antiraid_threshold || 10;
                    const joinCount = cache.recordJoin(member.guild.id);

                    if (joinCount >= threshold) {
                        console.warn(`[ANTI-RAID] Raid detected in ${member.guild.name}! (${joinCount} joins/min)`);

                        const { EmbedBuilder } = await import("discord.js");
                        const { sendLog } = await import("../core/logger.js");

                        const embed = new EmbedBuilder()
                            .setTitle("🚨 Anti-Raid Alert: Potential Raid Detected")
                            .setColor(0xFF0000)
                            .setDescription(`短時間に大量の参加を検知しました。\n**参加数**: ${joinCount} members / min\n**しきい値**: ${threshold}\n\n念のためサーバーの状態を確認してください。`)
                            .setTimestamp();

                        await sendLog(member.guild, 'ng', embed);
                    }
                }
            }
        } catch (e) {
            console.error("[EVENT ERROR] GuildMemberAdd:", e.message);
        }
    },
};
