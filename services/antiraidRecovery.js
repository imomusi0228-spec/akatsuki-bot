import { dbQuery } from "../core/db.js";
import { client } from "../core/client.js";
import { cache } from "../core/cache.js";
import pkg from "discord.js";
const { VerificationLevel } = pkg;

/**
 * Periodically checks for guilds in lockdown/caution mode and reverts them
 * if no raid activity has been detected for 30 minutes.
 */
export async function runAutoRecoveryCheck() {
    try {
        // Fetch guilds with auto-recovery enabled that are currently in a high guard level
        const res = await dbQuery("SELECT guild_id, antiraid_guard_level, last_raid_at FROM settings WHERE antiraid_auto_recovery_enabled = TRUE AND antiraid_guard_level > 0");
        const guilds = res.rows;

        for (const s of guilds) {
            if (!s.last_raid_at) continue;

            const lastRaid = new Date(s.last_raid_at);
            const now = new Date();
            const diffMins = (now - lastRaid) / (1000 * 60);

            // Revert after 30 minutes of peace
            if (diffMins >= 30) {
                console.log(`[AUTO-RECOVERY] Peace detected for ${diffMins.toFixed(1)} mins in guild ${s.guild_id}. Reverting to Normal mode.`);

                // 1. Update DB
                await dbQuery("UPDATE settings SET antiraid_guard_level = 0, updated_at = NOW() WHERE guild_id = $1", [s.guild_id]);

                // 2. Update Cache
                const cached = cache.getSettings(s.guild_id);
                if (cached) {
                    cache.setSettings(s.guild_id, { ...cached, antiraid_guard_level: 0 });
                }

                // 3. Revert Discord Tier (Verification Level)
                const guild = client.guilds.cache.get(s.guild_id);
                if (guild) {
                    try {
                        // If it was forced to VeryHigh during lockdown, drop it back to Medium
                        if (guild.verificationLevel === VerificationLevel.VeryHigh) {
                            await guild.setVerificationLevel(VerificationLevel.Medium, "Iron Fortress: Auto-Recovery System Activated");
                        }

                        // Send a log notice
                        const { EmbedBuilder } = await import("discord.js");
                        const { sendLog } = await import("../core/logger.js");
                        const embed = new EmbedBuilder()
                            .setTitle("🛡️ Iron Fortress: Auto-Recovery")
                            .setDescription("一定時間の平穏が確認されたため、防衛モードを自律的に解除し「通常モード」へ復帰しました。")
                            .setColor(0x00FF00)
                            .setTimestamp();

                        await sendLog(guild, 'ng', embed);
                    } catch (e) {
                        console.error(`[AUTO-RECOVERY ERROR] Discord API fail for ${s.guild_id}:`, e.message);
                    }
                }
            }
        }
    } catch (e) {
        console.error("[AUTO-RECOVERY ERROR]:", e.message);
    }
}
