import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { dbQuery } from "../core/db.js";
import { cache } from "../core/cache.js";

export const data = new SlashCommandBuilder()
    .setName("ngword")
    .setDescription("NGワードの管理")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("add")
            .setDescription("NGワードを追加")
            .addStringOption(opt => opt.setName("word").setDescription("検知する言葉 (または正規表現 /pattern/flags)").setRequired(true))
            .addStringOption(opt =>
                opt.setName("kind")
                    .setDescription("一致方法")
                    .addChoices(
                        { name: "部分一致 (Default)", value: "exact" },
                        { name: "正規表現 (Advanced)", value: "regex" }
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName("remove")
            .setDescription("NGワードを削除")
            .addIntegerOption(opt => opt.setName("id").setDescription("削除するID (listで確認してください)").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("現在のNGワード一覧を表示")
    )
    .addSubcommand(sub =>
        sub.setName("clear")
            .setDescription("NGワードを全て削除 (注意: 取り消せません)")
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "add") {
        const word = interaction.options.getString("word");
        const kind = interaction.options.getString("kind") || "exact";

        await dbQuery("INSERT INTO ng_words (guild_id, word, kind, created_by) VALUES ($1, $2, $3, $4)",
            [guildId, word, kind, interaction.user.id]);

        // Invalidate Cache
        cache.clearNgWords(guildId);

        await interaction.reply({ content: `✅ NGワード \`${word}\` (${kind}) を追加しました。`, flags: [MessageFlags.Ephemeral] });

    } else if (sub === "remove") {
        const id = interaction.options.getInteger("id");

        const res = await dbQuery("DELETE FROM ng_words WHERE id = $1 AND guild_id = $2 RETURNING word", [id, guildId]);
        if (res.rowCount === 0) {
            return interaction.reply({ content: "❌ 指定されたIDが見つからないか、権限がありません。", flags: [MessageFlags.Ephemeral] });
        }

        // Invalidate Cache
        cache.clearNgWords(guildId);

        await interaction.reply({ content: `✅ NGワード \`${res.rows[0].word}\` を削除しました。`, flags: [MessageFlags.Ephemeral] });

    } else if (sub === "list") {
        const res = await dbQuery("SELECT id, word, kind FROM ng_words WHERE guild_id = $1", [guildId]);
        if (res.rows.length === 0) {
            await interaction.reply({ content: "NGワードは登録されていません。", flags: [MessageFlags.Ephemeral] });
            return;
        }
        const list = res.rows.map(r => `・ID:${r.id} \`${r.word}\` (${r.kind})`).join("\n");
        await interaction.reply({ content: `📋 **NGワード一覧**\n${list}`, flags: [MessageFlags.Ephemeral] });
    }

    if (sub === "clear") {
        await dbQuery("DELETE FROM ng_words WHERE guild_id = $1", [guildId]);
        await interaction.reply({ content: "🗑️ NGワードを全て削除しました。", flags: [MessageFlags.Ephemeral] });
    }
}
