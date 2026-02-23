import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("rr")
    .setDescription("リアクションロールを管理します。")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(sub =>
        sub.setName("create")
            .setDescription("新規メッセージを送信してリアクションロールを作成します。")
            .addChannelOption(opt => opt.setName("channel").setDescription("メッセージを送信するチャンネル").setRequired(true))
            .addStringOption(opt => opt.setName("text").setDescription("メッセージの内容（\\nで改行可能）").setRequired(true))
            .addStringOption(opt => opt.setName("emoji").setDescription("使用する絵文字").setRequired(true))
            .addRoleOption(opt => opt.setName("role").setDescription("付与するロール").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("add")
            .setDescription("既存メッセージにリアクションロールを追加します。")
            .addStringOption(opt => opt.setName("message_id").setDescription("対象のメッセージID").setRequired(true))
            .addStringOption(opt => opt.setName("emoji").setDescription("使用する絵文字").setRequired(true))
            .addRoleOption(opt => opt.setName("role").setDescription("付与するロール").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("設定されているリアクションロールを一覧表示します。")
    )
    .addSubcommand(sub =>
        sub.setName("remove")
            .setDescription("リアクションロールを削除します。")
            .addIntegerOption(opt => opt.setName("id").setDescription("削除する設定のID").setRequired(true))
    );

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === "create") {
        const channel = interaction.options.getChannel("channel");
        const text = interaction.options.getString("text").replace(/\\n/g, "\n");
        const emoji = interaction.options.getString("emoji");
        const role = interaction.options.getRole("role");

        try {
            const msg = await channel.send(text);
            await msg.react(emoji);

            await dbQuery(
                "INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES ($1, $2, $3, $4)",
                [guildId, msg.id, emoji, role.id]
            );

            await interaction.editReply(`✅ リアクションロールを作成しました。\nチャンネル: <#${channel.id}>\nロール: <@&${role.id}>`);
        } catch (e) {
            console.error(e);
            await interaction.editReply(`❌ 作成に失敗しました。ボットにメッセージ送信やリアクションの権限があるか確認してください。`);
        }
    }

    if (sub === "add") {
        const messageId = interaction.options.getString("message_id");
        const emoji = interaction.options.getString("emoji");
        const role = interaction.options.getRole("role");

        try {
            const msg = await interaction.channel.messages.fetch(messageId);
            await msg.react(emoji);
        } catch (e) {
            return interaction.editReply(`❌ メッセージが見つからないか、絵文字が使用できません。このチャンネルにあるメッセージIDを指定してください。`);
        }

        await dbQuery(
            "INSERT INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES ($1, $2, $3, $4)",
            [guildId, messageId, emoji, role.id]
        );

        await interaction.editReply(`✅ リアクションロールを設定しました。\nメッセージID: \`${messageId}\` | 絵文字: ${emoji} | ロール: <@&${role.id}>`);
    }

    if (sub === "list") {
        const res = await dbQuery("SELECT id, message_id, emoji, role_id FROM reaction_roles WHERE guild_id = $1", [guildId]);

        if (res.rows.length === 0) {
            return interaction.editReply("ℹ️ 設定されているリアクションロールはありません。");
        }

        const embed = new EmbedBuilder()
            .setTitle("🎭 リアクションロール設定一覧")
            .setColor(0x5865F2)
            .setDescription(res.rows.map(r => `**ID: ${r.id}**\n└ Msg: \`${r.message_id}\` | Emoji: ${r.emoji} | Role: <@&${r.role_id}>`).join("\n\n"))
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    if (sub === "remove") {
        const id = interaction.options.getInteger("id");
        const res = await dbQuery("DELETE FROM reaction_roles WHERE id = $1 AND guild_id = $2", [id, guildId]);

        if (res.rowCount === 0) {
            return interaction.editReply(`❌ ID: \`${id}\` の設定が見つかりませんでした。`);
        }

        await interaction.editReply(`✅ ID: \`${id}\` のリアクションロール設定を削除しました。`);
    }
}
