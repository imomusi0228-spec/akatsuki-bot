import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from "discord.js";
import { dbQuery } from "../core/db.js";
import { sendLog } from "../core/logger.js";

export const data = new SlashCommandBuilder()
    .setName("scan")
    .setDescription("過去ログのNGワードスキャン")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption(opt => opt.setName("limit").setDescription("スキャンするメッセージ数 (最大100)").setMaxValue(100));

export async function execute(interaction) {
    const limit = interaction.options.getInteger("limit") || 50;
    const guildId = interaction.guild.id;

    await interaction.deferReply({ ephemeral: true });

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
            await sendLog(interaction.guild, 'ng', embed, msg.createdAt);
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
