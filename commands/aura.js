import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("aura")
    .setDescription("オーラ・システム（自動ロール付与）の設定を管理します。")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("現在設定されているオーラの一覧を表示します。")
    )
    .addSubcommand(sub =>
        sub.setName("add")
            .setDescription("新しいオーラ設定を追加します。")
            .addRoleOption(opt => opt.setName("role").setDescription("付与するロール").setRequired(true))
            .addIntegerOption(opt => opt.setName("hours").setDescription("必要な累計VC時間（時間）").setRequired(true))
            .addStringOption(opt => opt.setName("name").setDescription("オーラ名（表示用）").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("remove")
            .setDescription("オーラ設定を削除します。")
            .addIntegerOption(opt => opt.setName("index").setDescription("削除する設定の番号（/aura listで確認）").setRequired(true))
    );

export async function execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    // Fetch current settings
    const setRes = await dbQuery("SELECT vc_role_rules FROM settings WHERE guild_id = $1", [guildId]);
    let rules = (setRes.rows[0]?.vc_role_rules) || [];
    if (!Array.isArray(rules)) rules = [];

    if (sub === "list") {
        if (rules.length === 0) {
            await interaction.reply("現在設定されているオーラはありません。");
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle("✨ 現在のオーラ設定一覧")
            .setColor(0x1DA1F2)
            .setDescription(rules.map((r, i) => `**${i + 1}. ${r.aura_name}**\n└ ロール: <@&${r.role_id}>\n└ 必要時間: ${r.hours}時間`).join("\n\n"))
            .setFooter({ text: "Akatsuki Aura System" });

        await interaction.reply({ embeds: [embed] });
    }

    if (sub === "add") {
        const role = interaction.options.getRole("role");
        const hours = interaction.options.getInteger("hours");
        const name = interaction.options.getString("name");

        if (!role || !hours || !name) {
            await interaction.reply({ content: "❌ ロール、必要時間、オーラ名の全てを入力してください。", ephemeral: true });
            return;
        }

        const newRule = {
            role_id: role.id,
            hours: hours,
            aura_name: name
        };

        rules.push(newRule);

        // Upsert settings
        const check = await dbQuery("SELECT guild_id FROM settings WHERE guild_id = $1", [guildId]);
        if (check.rows.length === 0) {
            await dbQuery("INSERT INTO settings (guild_id, vc_role_rules) VALUES ($1, $2)", [guildId, JSON.stringify(rules)]);
        } else {
            await dbQuery("UPDATE settings SET vc_role_rules = $1 WHERE guild_id = $2", [JSON.stringify(rules), guildId]);
        }

        await interaction.reply(`✅ 新しいオーラ **${name}** を追加しました（<@&${role.id}> / ${hours}時間）。`);
    }

    if (sub === "remove") {
        const index = interaction.options.getInteger("index") - 1;

        if (index < 0 || index >= rules.length) {
            await interaction.reply({ content: "❌ 有効な番号を指定してください。一覧は `/aura list` で確認できます。", ephemeral: true });
            return;
        }

        const removed = rules.splice(index, 1);
        await dbQuery("UPDATE settings SET vc_role_rules = $1 WHERE guild_id = $2", [JSON.stringify(rules), guildId]);

        await interaction.reply(`✅ オーラ **${removed[0].aura_name}** を削除しました。`);
    }
}
