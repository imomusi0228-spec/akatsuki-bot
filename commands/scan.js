import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import { dbQuery } from "../core/db.js";
import { sendLog } from "../core/logger.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";
import { t } from "../core/i18n.js";

export const data = new SlashCommandBuilder()
    .setName("scan")
    .setNameLocalizations({ ja: "スキャン", "en-US": "scan", "en-GB": "scan" })
    .setDescription("Scans or restores past message logs (Pro+ only).")
    .setDescriptionLocalizations({
        ja: "過去ログのスキャン・復元を実行します（Pro+限定）。",
        "en-US": "Scans or restores past message logs (Pro+ only).",
        "en-GB": "Scans or restores past message logs (Pro+ only)."
    })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
        opt.setName("type")
            .setNameLocalizations({ ja: "タイプ", "en-US": "type", "en-GB": "type" })
            .setDescription("The type of scan.")
            .setDescriptionLocalizations({
                ja: "スキャンの種類",
                "en-US": "The type of scan.",
                "en-GB": "The type of scan."
            })
            .setRequired(true)
            .addChoices(
                { name: "NGワード (NG Words)", value: "ng" },
                { name: "VCログ (VC Logs)", value: "vc" }
            )
    )
    .addIntegerOption(opt => opt
        .setName("limit")
        .setNameLocalizations({ ja: "制限", "en-US": "limit", "en-GB": "limit" })
        .setDescription("Messages count for NG / Days for VC (Max 30).")
        .setDescriptionLocalizations({
            ja: "NGスキャン時の件数 / VCスキャン時の日数 (最大30)",
            "en-US": "Messages count for NG / Days for VC (Max 30).",
            "en-GB": "Messages count for NG / Days for VC (Max 30)."
        })
        .setMaxValue(100));

export async function execute(interaction) {
    const locale = interaction.locale.startsWith("ja") ? "ja" : "en";
    const type = interaction.options.getString("type");
    const limit = interaction.options.getInteger("limit") || (type === 'vc' ? 3 : 50);
    const guildId = interaction.guild.id;

    const tier = await getTier(guildId);
    const features = getFeatures(tier, guildId, interaction.user.id);
    if (!features.audit) {
        return interaction.reply({
            content: `❌ ${t("feat_list_pro_plus", locale).replace(/<\/?[^>]+(>|$)/g, "")}\n${t("help_footer", locale)}`,
            flags: [MessageFlags.Ephemeral]
        });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    if (type === 'vc') {
        const days = Math.min(limit, 30);
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);

        const res = await dbQuery(`
            SELECT * FROM vc_sessions 
            WHERE guild_id = $1 AND join_time >= $2
            ORDER BY join_time ASC
        `, [guildId, targetDate]);

        if (res.rows.length === 0) {
            await interaction.editReply(`✅ ${locale === "ja" ? `過去${days}日間のVC記録は見つかりませんでした。` : `No VC records found for the past ${days} days.`}`);
            return;
        }

        let recoveredCount = 0;
        await interaction.editReply(`⏳ ${locale === "ja" ? `過去${days}日間のVCログを復元中... (${res.rows.length}件)` : `Restoring VC logs from the past ${days} days... (${res.rows.length} records)`}`);

        const userIds = [...new Set(res.rows.map(r => r.user_id))];
        await interaction.guild.members.fetch({ user: userIds }).catch(() => { });

        for (const session of res.rows) {
            const member = interaction.guild.members.cache.get(session.user_id);
            const userDisplay = member ? `${member.displayName}` : `User(${session.user_id})`;
            const avatarUrl = member ? member.user.displayAvatarURL() : null;

            let channelName = locale === "ja" ? "(不明)" : "(Unknown)";
            if (session.channel_id) {
                const ch = interaction.guild.channels.cache.get(session.channel_id);
                if (ch) channelName = `#${ch.name}`;
            }

            const joinDate = session.join_time;
            const embedJoin = new EmbedBuilder()
                .setAuthor({ name: userDisplay, iconURL: avatarUrl })
                .setColor(0x00FF00)
                .setDescription(`📥 [${locale === "ja" ? "復元" : "Restored"}] ${t("stat_vc_in", locale)}: **${channelName}**`)
                .setFooter({ text: locale === "ja" ? "過去ログスキャンによる復元" : "Restored via log scan" })
                .setTimestamp(joinDate);

            await sendLog(interaction.guild, 'vc_in', embedJoin, joinDate, { checkDuplicate: true });
            recoveredCount++;

            if (session.leave_time) {
                const leaveDate = session.leave_time;
                const duration = session.duration_seconds;
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const durationStr = locale === "ja"
                    ? (minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`)
                    : (minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);

                const embedLeave = new EmbedBuilder()
                    .setAuthor({ name: userDisplay, iconURL: avatarUrl })
                    .setColor(0xFF0000)
                    .setDescription(`📤 [${locale === "ja" ? "復元" : "Restored"}] ${t("stat_vc_out", locale)}: **${channelName}**\n⌛ ${locale === "ja" ? "滞在時間" : "Duration"}: **${durationStr}**`)
                    .setFooter({ text: locale === "ja" ? "過去ログスキャンによる復元" : "Restored via log scan" })
                    .setTimestamp(leaveDate);

                await sendLog(interaction.guild, 'vc_out', embedLeave, leaveDate, { checkDuplicate: true });
                recoveredCount++;
            }
        }

        await interaction.editReply(`✅ ${locale === "ja" ? `復元完了: **${recoveredCount}** 件のVCログをスレッドに再投稿しました。` : `Restoration complete: Re-posted **${recoveredCount}** VC logs to the thread.`}`);

    } else {
        const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
        const ngWords = res.rows;

        if (ngWords.length === 0) {
            await interaction.editReply(t("ng_none", locale));
            return;
        }

        const messages = await interaction.channel.messages.fetch({ limit });
        let detectedCount = 0;
        let detectedList = [];

        const sortedMessages = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        for (const msg of sortedMessages) {
            if (msg.author.bot) continue;

            let caught = false;
            let caughtWord = "";

            for (const ng of ngWords) {
                if (ng.kind === "regex") {
                    try {
                        const match = ng.word.match(/^\/(.*?)\/([gimsuy]*)$/);
                        const regex = match ? new RegExp(match[1], match[2]) : new RegExp(ng.word);
                        if (regex.test(msg.content)) { caught = true; caughtWord = ng.word; }
                    } catch (e) { }
                } else {
                    if (msg.content.includes(ng.word)) { caught = true; caughtWord = ng.word; }
                }
                if (caught) break;
            }

            if (caught) {
                detectedCount++;
                detectedList.push(`- [Link](${msg.url}) by <@${msg.author.id}>: ||${caughtWord}||`);

                const embed = new EmbedBuilder()
                    .setTitle(`🚫 ${locale === "ja" ? "過去ログNGワード検知" : "Past Log NG Word Detected"}`)
                    .setColor(0xff0000)
                    .setDescription(`**${t("user", locale)}:** <@${msg.author.id}> (${msg.author.tag})\n**${locale === "ja" ? "検知ワード" : "Detected Word"}:** ||${caughtWord}||\n**${t("log_channel", locale)}:** <#${msg.channel.id}>\n**${locale === "ja" ? "リンク" : "Link"}:** [${locale === "ja" ? "メッセージへ移動" : "Jump to Message"}](${msg.url})`)
                    .setTimestamp(msg.createdAt);

                await sendLog(interaction.guild, 'ng', embed, msg.createdAt, { checkDuplicate: true });
            }
        }

        if (detectedCount === 0) {
            await interaction.editReply(`✅ ${locale === "ja" ? `過去${limit}件のメッセージにNGワードは見つかりませんでした。` : `No NG words found in the past ${limit} messages.`}`);
        } else {
            const report = detectedList.slice(0, 10).join("\n");
            const more = detectedList.length > 10 ? (locale === "ja" ? `\n...他 ${detectedList.length - 10} 件` : `\n...and ${detectedList.length - 10} more`) : "";
            await interaction.editReply(`⚠️ **${detectedCount}${locale === "ja" ? "件" : " records"}** ${locale === "ja" ? "のNGワード候補が見つかりました。" : " of potential NG words found."}\n${locale === "ja" ? "ログチャンネルにも通知を送信しました。" : "Notifications sent to the log channel."}\n${report}${more}`);
        }
    }
}
