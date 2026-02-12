import { Events, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { sendLog } from "../core/logger.js";
import { cache } from "../core/cache.js";

export default {
    name: Events.GuildMemberAdd,
    async default(member) {
        if (member.user.bot) return;

        try {
            // 1. Record Join Event
            await dbQuery(
                "INSERT INTO member_events (guild_id, user_id, event_type) VALUES ($1, $2, $3)",
                [member.guild.id, member.user.id, 'join']
            );
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
                    const joinCountRes = await dbQuery(
                        "SELECT COUNT(*) as cnt FROM member_events WHERE guild_id = $1 AND event_type = 'join' AND created_at > NOW() - INTERVAL '1 minute'",
                        [member.guild.id]
                    );
                    const joinCount = parseInt(joinCountRes.rows[0].cnt);

                    if (joinCount >= threshold) {
                        console.warn(`[ANTI-RAID] Raid detected in ${member.guild.name}! (${joinCount} joins/min)`);

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
