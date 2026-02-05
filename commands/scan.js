import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

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

    messages.forEach(msg => {
        if (msg.author.bot) return;

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
        }
    });

    if (detectedCount === 0) {
        await interaction.editReply(`✅ 過去${limit}件のメッセージにNGワードは見つかりませんでした。`);
    } else {
        const report = detectedList.slice(0, 10).join("\n");
        const more = detectedList.length > 10 ? `\n...他 ${detectedList.length - 10} 件` : "";
        await interaction.editReply(`⚠️ **${detectedCount}件** のNGワード候補が見つかりました:\n${report}${more}`);
    }
}
