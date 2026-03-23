import { Events, EmbedBuilder, ChannelType } from "discord.js";
import { dbQuery } from "../core/db.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { cache } from "../core/cache.js";
import { batcher } from "../core/batcher.js";
import {
    checkSpam,
    checkMentionSpam,
    checkRateLimit,
    checkGlobalSpam,
    checkSuspiciousContent,
    isMemberRestricted,
    checkCrossUserMentionSpam,
} from "../core/protection.js";
import { sendLog } from "../core/logger.js";

export default {
    name: Events.MessageCreate,
    async default(message) {
        if (message.author.bot || !message.guild) return;

        try {
            const guildId = message.guild.id;
            const userId = message.author.id;

            // 1. Fetch Settings & Tier (Cached)
            let settings = cache.getSettings(guildId);
            if (!settings) {
                const res = await dbQuery("SELECT * FROM settings WHERE guild_id = $1", [guildId]);
                settings = res.rows[0] || {};
                cache.setSettings(guildId, settings);
            }

            const tier = await getTier(guildId);
            const features = getFeatures(tier);

            // 2. Track activity & Leveling (Optimized with Cache & Batcher)
            const statsKey = `${guildId}:${userId}`;
            let row = cache.getMemberStats(guildId, userId);
            if (!row) {
                const statsRes = await dbQuery(
                    "SELECT xp, level, message_count, last_xp_gain_at FROM member_stats WHERE guild_id = $1 AND user_id = $2",
                    [guildId, userId]
                );
                row = statsRes.rows[0] || { xp: 0, level: 1, message_count: 0 };
                cache.setMemberStats(guildId, userId, row);
            }

            const now = Date.now();
            const lastGain = row.last_xp_gain_at ? new Date(row.last_xp_gain_at).getTime() : 0;
            
            let xpToGain = 0;
            if (now - lastGain > 60000) {
                xpToGain = Math.floor(Math.random() * 21) + 20;
            }

            let currentLevel = row.level || 1;
            let currentXp = (row.xp || 0) + xpToGain;
            const nextLevelXp = currentLevel * currentLevel * 80;

            let levelUp = false;
            if (currentXp >= nextLevelXp) {
                currentLevel++;
                levelUp = true;
            }

            // Update Cache & Push to Batcher (No direct DB write!)
            const updateData = {
                guild_id: guildId,
                user_id: userId,
                xp: xpToGain,
                level: currentLevel,
                message_count: 1,
            };
            if (xpToGain > 0) updateData.last_xp_gain_at = new Date(now);
            
            cache.updateMemberStats(guildId, userId, updateData);
            batcher.push("member_stats", updateData);

            const msgCount = (row.message_count || 0) + 1;

            // Log activity to batcher for AI Prediction
            batcher.push("member_events", {
                guild_id: guildId,
                user_id: userId,
                event_type: "message",
            });

            if (levelUp && settings.levelup_enabled !== false) {
                const embedColor = settings.color_level
                    ? parseInt(settings.color_level.replace("#", ""), 16)
                    : 0xffd700;
                const embed = new EmbedBuilder()
                    .setTitle("🎊 Level Up!")
                    .setDescription(
                        `おめでとうございます <@${userId}> さん！\nレベルが **Level ${currentLevel}** に到達しました！`
                    )
                    .setColor(embedColor)
                    .setThumbnail(message.author.displayAvatarURL())
                    .setFooter({
                        text: settings.branding_footer_text || "Akatsuki Leveling System",
                    })
                    .setTimestamp();

                const targetChannel = settings.levelup_channel_id
                    ? message.guild.channels.cache.get(settings.levelup_channel_id)
                    : message.channel;
                if (targetChannel) await targetChannel.send({ embeds: [embed] }).catch(() => {});
            }

            // 3. Spam & Security Protection (Iron Fortress)
            if (features.spamProtection || features.antiraid) {
                const spamCheck = checkSpam(guildId, userId, message.content);
                const mentionCount = message.mentions.users.size + message.mentions.roles.size;
                const mentionCheck = checkMentionSpam(guildId, userId, mentionCount);
                const rateCheck = checkRateLimit(guildId, userId);
                const globalCheck = checkGlobalSpam(guildId, userId, message.content);
                const isRestricted = isMemberRestricted(message.member, settings);
                const suspicious = checkSuspiciousContent(
                    message.content,
                    settings.domain_blacklist || []
                );
                const crossMention = checkCrossUserMentionSpam(guildId, [
                    ...message.mentions.users.keys(),
                ]);

                let honeypotActive = false;
                if (settings.antiraid_honeypot_channel_id === message.channel.id) {
                    const staffId = settings.ticket_staff_role_id;
                    if (!staffId || !message.member.roles.cache.has(staffId)) honeypotActive = true;
                }

                if (
                    spamCheck.isSpam ||
                    mentionCheck.isSpam ||
                    rateCheck.isSpam ||
                    globalCheck.isSpam ||
                    (isRestricted && settings.antiraid_guard_level >= 1) ||
                    suspicious.isSuspicious ||
                    crossMention.isSpam ||
                    honeypotActive
                ) {
                    let action = "Delete";
                    let reason = "Security Violation";
                    const isRaid =
                        globalCheck.isSpam ||
                        (isRestricted && settings.antiraid_guard_level >= 2) ||
                        crossMention.isSpam ||
                        honeypotActive;

                    if (spamCheck.isSpam) reason = "Similarity Spam";
                    else if (mentionCheck.isSpam) reason = "Mention Spam";
                    else if (rateCheck.isSpam) reason = "Rate Limit (Frequency)";
                    else if (globalCheck.isSpam) reason = "Global Raid Spam";
                    else if (isRestricted) reason = "Newcomer Restriction";
                    else if (suspicious.isSuspicious) reason = "Suspicious Links/Content";
                    else if (crossMention.isSpam) reason = "Mass Mention Raid";
                    else if (honeypotActive) reason = "Honeypot Trap";

                    await message.delete().catch(() => {});

                    if (isRaid) {
                        const count = Math.max(spamCheck.count || 0, globalCheck.count || 0);
                        if (count >= 5 || honeypotActive) {
                            if (honeypotActive && message.member.bannable) {
                                await message.member
                                    .ban({ reason: "Honeypot Trap" })
                                    .catch(() => {});
                                action = "Banned";
                            } else if (message.member.kickable) {
                                await message.member.kick("Raid Guard").catch(() => {});
                                action = "Kicked";
                            }
                        }
                        await dbQuery(
                            "UPDATE settings SET last_raid_at = NOW() WHERE guild_id = $1",
                            [guildId]
                        );
                    }

                    if (features.ngLog) {
                        const logEmbed = new EmbedBuilder()
                            .setAuthor({
                                name: message.member.displayName,
                                iconURL: message.author.displayAvatarURL(),
                            })
                            .setColor(isRaid ? 0xff0000 : 0xffaa00)
                            .setTitle(`🛡️ Iron Fortress: ${reason}`)
                            .setDescription(`**ユーザー**: <@${userId}>\n**アクション**: ${action}`)
                            .setTimestamp();
                        await sendLog(message.guild, "mod", logEmbed);
                    }
                    return;
                }
            }

            // 4. NG Word Filter
            let ngWords = cache.getNgWords(guildId);
            if (!ngWords) {
                const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
                ngWords = res.rows;
                cache.setNgWords(guildId, ngWords);
            }

            if (ngWords && (ngWords.combinedPattern || ngWords.words.some(w => w.kind === "regex"))) {
                let caught = [];
                
                // Fast combined check for exact words O(1) approx
                if (ngWords.combinedPattern && ngWords.combinedPattern.test(message.content)) {
                    // Refine to find which word exactly (for logging)
                    caught = ngWords.words.filter(w => w.kind !== "regex" && message.content.toLowerCase().includes(w.word.toLowerCase()));
                }
                
                // Regex checks (Pre-compiled)
                const regexWords = ngWords.words.filter(w => w.kind === "regex");
                for (const rw of regexWords) {
                    if (rw.compiled && rw.compiled.test(message.content)) {
                        caught.push(rw);
                    }
                }

                if (caught.length > 0) {
                    await message.delete().catch(() => {});
                    caught.forEach((c) =>
                        batcher.push("ng_logs", {
                            guild_id: guildId,
                            user_id: userId,
                            user_name: message.author.tag,
                            word: c.word,
                        })
                    );

                    if (settings.ng_warning_enabled !== false) {
                        await message.author
                            .send(`⚠️ **禁止ワードを検知しました** (${message.guild.name})`)
                            .catch(() => {});
                    }

                    const countRes = await dbQuery(
                        "SELECT COUNT(*) as cnt FROM ng_logs WHERE guild_id = $1 AND user_id = $2 AND created_at > NOW() - INTERVAL '1 hour'",
                        [guildId, userId]
                    );
                    const count = parseInt(countRes.rows[0].cnt);
                    let actionTaken = "Deleted";

                    if (count >= (settings.phase2_threshold ?? 3)) {
                        const action =
                            count >= (settings.phase4_threshold ?? 10)
                                ? settings.phase4_action
                                : count >= (settings.phase3_threshold ?? 6)
                                  ? settings.phase3_action
                                  : settings.phase2_action;
                        if (action === "timeout" && message.member.moderatable) {
                            await message.member.timeout(
                                (settings.timeout_minutes || 10) * 60000,
                                "NG Word Threshold"
                            );
                            actionTaken = "Timeout";
                        } else if (action === "kick" && message.member.kickable) {
                            await message.member.kick("NG Word Limit");
                            actionTaken = "Kicked";
                        }
                    }

                    if (features.ngLog) {
                        const embed = new EmbedBuilder()
                            .setAuthor({
                                name: message.member.displayName,
                                iconURL: message.author.displayAvatarURL(),
                            })
                            .setColor(0xff0000)
                            .setTitle("🚨 NG Word Detected")
                            .setDescription(
                                `**ワード**: ||${caught.map((c) => c.word).join(", ")}||\n**状況**: ${actionTaken}`
                            )
                            .setTimestamp();
                        await sendLog(message.guild, "ng", embed);
                    }
                }
            }

            // 5. Self-Intro Gate
            if (
                features.introGate &&
                settings.self_intro_enabled &&
                settings.intro_channel_id === message.channel.id
            ) {
                if (
                    message.content.length >= (settings.self_intro_min_length || 10) &&
                    settings.self_intro_role_id
                ) {
                    if (!message.member.roles.cache.has(settings.self_intro_role_id)) {
                        await message.member.roles
                            .add(settings.self_intro_role_id, "Auto-Gate Pattern")
                            .catch(() => {});
                        await message.react("✅").catch(() => {});
                    }
                }
            }

            // 6. Message-based Aura (Optimized check)
            if (features.aura) {
                const rules = (settings.vc_role_rules || []).filter(
                    (r) => r.trigger === "messages"
                );
                for (const rule of rules) {
                    if (
                        msgCount >= rule.messages &&
                        !message.member.roles.cache.has(rule.role_id)
                    ) {
                        await message.member.roles.add(rule.role_id).catch(() => null);
                    }
                }
            }
        } catch (e) {
            console.error("[EVENT ERROR] messageCreate:", e.message);
        }
    },
};
