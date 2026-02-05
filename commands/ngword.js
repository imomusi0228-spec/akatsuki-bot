import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("ngword")
    .setDescription("NGワードの管理")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("add")
            .setDescription("NGワードを追加")
            .addStringOption(opt => opt.setName("word").setDescription("追加する言葉").setRequired(true))
            .addBooleanOption(opt => opt.setName("regex").setDescription("正規表現として追加").setRequired(false))
    )
    .addSubcommand(sub =>
        sub.setName("remove")
            .setDescription("NGワードを削除")
            .addStringOption(opt => opt.setName("word").setDescription("削除する言葉").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("NGワード一覧を表示")
    )
    .addSubcommand(sub =>
        sub.setName("clear")
            .setDescription("NGワードを全削除")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "add") {
        const word = interaction.options.getString("word");
        const isRegex = interaction.options.getBoolean("regex") || false;

        await dbQuery("INSERT INTO ng_words (guild_id, word, kind, created_by) VALUES ($1, $2, $3, $4)", [guildId, word, isRegex ? "regex" : "exact", interaction.user.tag]);
        await interaction.reply({ content: `✅ NGワードを追加しました: \`${word}\` (${isRegex ? "正規表現" : "完全一致"})`, ephemeral: true });
    }

    if (sub === "remove") {
        const word = interaction.options.getString("word");
        const res = await dbQuery("DELETE FROM ng_words WHERE guild_id = $1 AND word = $2 RETURNING *", [guildId, word]);
        if (res.rowCount > 0) {
            await interaction.reply({ content: `✅ NGワードを削除しました: \`${word}\``, ephemeral: true });
        } else {
            await interaction.reply({ content: `⚠️ その言葉は登録されていません: \`${word}\``, ephemeral: true });
        }
    }

    if (sub === "list") {
        const res = await dbQuery("SELECT word, kind FROM ng_words WHERE guild_id = $1", [guildId]);
        if (res.rows.length === 0) {
            await interaction.reply({ content: "NGワードは登録されていません。", ephemeral: true });
            return;
        }
        const list = res.rows.map(r => `・\`${r.word}\` (${r.kind})`).join("\n");
        await interaction.reply({ content: `📋 **NGワード一覧**\n${list}`, ephemeral: true });
    }

    if (sub === "clear") {
        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1", [guildId]);
        await interaction.reply({ content: "🗑️ NGワードを全て削除しました。", ephemeral: true });
    }
}
