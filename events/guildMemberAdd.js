import pkg from "discord.js";
const { Events, EmbedBuilder, VerificationLevel } = pkg;
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
            batcher.push("member_events", {
                guild_id: member.guild.id,
                user_id: member.user.id,
                event_type: "join",
            });
            console.log(`[EVENT] Member Joined: ${member.user.tag} in ${member.guild.name}`);

            // 2. Anti-Raid Detection (Pro/Pro+)
            const tier = await getTier(member.guild.id);
            const features = getFeatures(tier);

            if (features.antiraid) {
                let settings = cache.getSettings(member.guild.id);
                if (!settings) {
                    const settingsRes = await dbQuery(
                        "SELECT * FROM settings WHERE guild_id = $1",
                        [member.guild.id]
                    );
                    settings = settingsRes.rows[0] || {};
                    cache.setSettings(member.guild.id, settings);
                }

                const guardLevel = settings.antiraid_guard_level || 0;
                const threshold = settings.antiraid_threshold || 10;
                const raidThreshold = settings.raid_join_threshold || threshold;
                const joinCount = cache.recordJoin(member.guild.id);

                // 2.0 Avatar Scrutiny (v2.4.9)
                let suspiciousBurst = false;
                if (settings.antiraid_avatar_scrutiny_enabled && !member.user.avatar) {
                    const { recordAvatarJoin } = await import("../core/protection.js");
                    suspiciousBurst = recordAvatarJoin(member.guild.id);
                }

                // 2.1 Rapid Join Detection & Auto-Lockdown
                // If suspicious burst (avatar-less), lower threshold by 50%
                const effectiveThreshold = suspiciousBurst
                    ? Math.max(2, Math.floor(raidThreshold / 2))
                    : raidThreshold;

                if (joinCount >= effectiveThreshold) {
                    console.warn(
                        `[ANTI-RAID] Raid detected in ${member.guild.name}! (${joinCount} joins/min, Audit: ${suspiciousBurst ? "Avatar-less Burst" : "Regular Rate"})`
                    );

                    const { EmbedBuilder, VerificationLevel } = await import("discord.js");
                    const { sendLog } = await import("../core/logger.js");

                    let actionTaken = "Alert Sent";

                    // Handle Auto-Lockdown if Mode is yellow/red or threshold is very high
                    if (guardLevel >= 1 || joinCount >= raidThreshold * 2) {
                        try {
                            if (member.guild.verificationLevel !== VerificationLevel.VeryHigh) {
                                await member.guild.setVerificationLevel(
                                    VerificationLevel.VeryHigh,
                                    "Anti-Raid Auto-Lockdown Triggered"
                                );
                                actionTaken = "Lockdown (Highest Verification Level)";

                                // Auto-upgrade mode to Red internally if it was lower
                                if (guardLevel < 2) {
                                    await dbQuery(
                                        "UPDATE settings SET antiraid_guard_level = 2, updated_at = NOW(), last_raid_at = NOW() WHERE guild_id = $1",
                                        [member.guild.id]
                                    );
                                    cache.setSettings(member.guild.id, {
                                        ...settings,
                                        antiraid_guard_level: 2,
                                        last_raid_at: new Date(),
                                    });
                                } else {
                                    await dbQuery(
                                        "UPDATE settings SET last_raid_at = NOW() WHERE guild_id = $1",
                                        [member.guild.id]
                                    );
                                }
                            } else {
                                await dbQuery(
                                    "UPDATE settings SET last_raid_at = NOW() WHERE guild_id = $1",
                                    [member.guild.id]
                                );
                            }
                        } catch (e) {
                            console.error(
                                "[ANTI-RAID] Failed to set verification level:",
                                e.message
                            );
                            actionTaken = "Alert (Lockdown Failed - No Perms?)";
                        }
                    }

                    const embed = new EmbedBuilder()
                        .setTitle("🚨 Anti-Raid Alert: Iron Fortress Triggered")
                        .setColor(0xff0000)
                        .setDescription(
                            `短時間に異常な参加（レイド）を検知しました。\n\n**参加状況**: ${joinCount} members / min\n**防衛しきい値**: ${raidThreshold}\n**現在のモード**: ${guardLevel === 0 ? "通常" : guardLevel === 1 ? "警戒" : "防衛"}\n**実施アクション**: \`${actionTaken}\``
                        )
                        .setFooter({
                            text: "自動ロックダウンが発動した場合、Web盤面から解除してください。",
                        })
                        .setTimestamp();

                    await sendLog(member.guild, "ng", embed);
                }

                // 2.2 Newcomer Restriction Pre-Check
                // (Logic to be handled in messageCreate, but we can log initial state here if needed)
            }
        } catch (e) {
            console.error("[EVENT ERROR] GuildMemberAdd:", e.message);
        }

        // A-3: サーバー参加メッセージ
        try {
            let settings = cache.getSettings(member.guild.id);
            if (!settings) {
                const r = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [
                    member.guild.id,
                ]);
                settings = r.rows[0] || {};
                cache.setSettings(member.guild.id, settings);
            }
            if (settings.welcome_enabled && settings.welcome_channel_id) {
                const channel = member.guild.channels.cache.get(settings.welcome_channel_id);
                if (channel) {
                    const tmpl =
                        settings.welcome_message || "👋 {user} さん、**{server}** へようこそ！";
                    const msg = tmpl
                        .replace(/{user}/g, `<@${member.id}>`)
                        .replace(/{username}/g, member.user.username)
                        .replace(/{server}/g, member.guild.name)
                        .replace(/{count}/g, String(member.guild.memberCount));
                    await channel.send(msg).catch(() => {});
                }
            }
        } catch (e) {
            console.error("[A-3 Welcome] Error:", e.message);
        }
    },
};
