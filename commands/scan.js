import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from "discord.js";
import { dbQuery } from "../core/db.js";
import { sendLog } from "../core/logger.js";
import { getTier } from "../core/subscription.js";
import { getFeatures } from "../core/tiers.js";

export const data = new SlashCommandBuilder()
    .setName("scan")
    .setDescription("過去ログのスキャン・復元")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(opt =>
        opt.setName("type")
            .setDescription("スキャンの種類")
            .setRequired(true)
            .addChoices(
                { name: "NGワード (過去メッセージ)", value: "ng" },
                { name: "VCログ (活動履歴)", value: "vc" }
            )
    )
    .addIntegerOption(opt => opt.setName("limit").setDescription("NGスキャン時の件数 / VCスキャン時の日数 (最大30)").setMaxValue(100));

export async function execute(interaction) {
    const type = interaction.options.getString("type");
    const limit = interaction.options.getInteger("limit") || (type === 'vc' ? 3 : 50);
    const guildId = interaction.guild.id;

    // Pro+ のみ利用可能
    const tier = await getTier(guildId);
    const features = getFeatures(tier);
    if (!features.audit) {
        return interaction.reply({
            content: "❌ `/scan` コマンドは **Pro+** プランのみご利用いただけます。\n詳細は `/activity` または Web管理画面からご確認ください。",
            flags: [MessageFlags.Ephemeral]
        });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    if (type === 'vc') {
        const days = Math.min(limit, 30); // Max 30 days
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() - days);

        // Fetch past sessions
        // channel_id might be null for old data
        const res = await dbQuery(`
            SELECT * FROM vc_sessions 
            WHERE guild_id = $1 AND join_time >= $2
            ORDER BY join_time ASC
        `, [guildId, targetDate]);

        if (res.rows.length === 0) {
            await interaction.editReply(`✅ 過去${days}日間のVC記録は見つかりませんでした。`);
            return;
        }

        let recoveredCount = 0;
        await interaction.editReply(`⏳ 過去${days}日間のVCログを復元中... (${res.rows.length}件)`);

        // Optimization: Batch fetch members to warm the cache and avoid rate limits in loop
        const userIds = [...new Set(res.rows.map(r => r.user_id))];
        await interaction.guild.members.fetch({ user: userIds }).catch(() => { });

        for (const session of res.rows) {
            // Use cache first (it should be warmed now)
            const member = interaction.guild.members.cache.get(session.user_id);
            const userDisplay = member ? `${member.displayName}` : `User(${session.user_id})`;
            const avatarUrl = member ? member.user.displayAvatarURL() : null;

            // Channel Name Correction
            let channelName = "(不明)";
            if (session.channel_id) {
                const ch = interaction.guild.channels.cache.get(session.channel_id);
                if (ch) channelName = `#${ch.name}`;
            }

            // JOIN Log
            const joinDate = session.join_time; // Date object from pg
            const embedJoin = new EmbedBuilder()
                .setAuthor({ name: userDisplay, iconURL: avatarUrl })
                .setColor(0x00FF00) // Green
                .setDescription(`📥 [復元] 入室: **${channelName}**`)
                .setFooter({ text: "過去ログスキャンによる復元" })
                .setTimestamp(joinDate);

            await sendLog(interaction.guild, 'vc_in', embedJoin, joinDate, { checkDuplicate: true });
            recoveredCount++;

            // LEAVE Log (if exists)
            if (session.leave_time) {
                const leaveDate = session.leave_time;
                const duration = session.duration_seconds;
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const durationStr = minutes > 0 ? `${minutes}分${seconds}秒` : `${seconds}秒`;

                const embedLeave = new EmbedBuilder()
                    .setAuthor({ name: userDisplay, iconURL: avatarUrl })
                    .setColor(0xFF0000) // Red
                    .setDescription(`📤 [復元] 退室: **${channelName}**\n⌛ 滞在時間: **${durationStr}**`)
                    .setFooter({ text: "過去ログスキャンによる復元" })
                    .setTimestamp(leaveDate);

                await sendLog(interaction.guild, 'vc_out', embedLeave, leaveDate, { checkDuplicate: true });
                recoveredCount++;
            }
        }

        await interaction.editReply(`✅ 復元完了: **${recoveredCount}** 件のVCログをスレッドに再投稿しました。`);

    } else {
        // NG Scan (Default)
        // Get NG Words
        const res = await dbQuery("SELECT * FROM ng_words WHERE guild_id = $1", [guildId]);
        const ngWords = res.rows;

        if (ngWords.length === 0) {
            await interaction.editReply("NGワードが設定されていません。");
            return;
        }

        const messages = await interaction.channel.messages.fetch({ limit });
        let detectedCount = 0;
        let detectedList = [];

        // Chronological order for logs
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

                // Send Log to NG Channel (using message date)
                const embed = new EmbedBuilder()
                    .setTitle("🚫 過去ログNGワード検知")
                    .setColor(0xff0000)
                    .setDescription(`**ユーザー:** <@${msg.author.id}> (${msg.author.tag})\n**検知ワード:** ||${caughtWord}||\n**チャンネル:** <#${msg.channel.id}>\n**リンク:** [メッセージへ移動](${msg.url})`)
                    .setTimestamp(msg.createdAt);

                // Pass message creation date to sendLog to ensure it goes to correct thread
                await sendLog(interaction.guild, 'ng', embed, msg.createdAt, { checkDuplicate: true });
            }
        }

        if (detectedCount === 0) {
            await interaction.editReply(`✅ 過去${limit}件のメッセージにNGワードは見つかりませんでした。`);
        } else {
            const report = detectedList.slice(0, 10).join("\n");
            const more = detectedList.length > 10 ? `\n...他 ${detectedList.length - 10} 件` : "";
            await interaction.editReply(`⚠️ **${detectedCount}件** のNGワード候補が見つかりました。\nログチャンネルにも通知を送信しました。\n${report}${more}`);
        }
    }
}
