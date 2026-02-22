import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from "discord.js";
import { dbQuery } from "../core/db.js";

export const data = new SlashCommandBuilder()
    .setName("warn")
    .setDescription("メンバーへの警告を管理します。")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand(sub =>
        sub.setName("issue")
            .setDescription("メンバーに警告を発行します。")
            .addUserOption(opt => opt.setName("user").setDescription("警告対象のメンバー").setRequired(true))
            .addStringOption(opt => opt.setName("reason").setDescription("警告理由").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("list")
            .setDescription("メンバーの警告履歴を表示します。")
            .addUserOption(opt => opt.setName("user").setDescription("確認するメンバー").setRequired(true))
    )
    .addSubcommand(sub =>
        sub.setName("clear")
            .setDescription("メンバーの警告をリセットします。")
            .addUserOption(opt => opt.setName("user").setDescription("リセット対象のメンバー").setRequired(true))
    );

export async function execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const targetUser = interaction.options.getUser("user");

    if (sub === "issue") {
        const reason = interaction.options.getString("reason");

        await dbQuery(
            "INSERT INTO warnings (guild_id, user_id, reason, issued_by) VALUES ($1, $2, $3, $4)",
            [guildId, targetUser.id, reason, interaction.user.id]
        );

        const countRes = await dbQuery(
            "SELECT COUNT(*) as cnt FROM warnings WHERE guild_id = $1 AND user_id = $2",
            [guildId, targetUser.id]
        );
        const totalWarnings = parseInt(countRes.rows[0].cnt);

        // DMで本人に通知
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle("⚠️ 警告を受けました")
                .setColor(0xFFAA00)
                .setDescription(
                    `**サーバー**: ${interaction.guild.name}\n` +
                    `**理由**: ${reason}\n` +
                    `**累計警告数**: ${totalWarnings}回\n\n` +
                    `*繰り返し違反した場合、より重い制裁が適用される場合があります。*`
                )
                .setTimestamp();
            await targetUser.send({ embeds: [dmEmbed] });
        } catch (_) { /* DM拒否は無視 */ }

        // ログへ送信
        const { sendLog } = await import("../core/logger.js");
        const logEmbed = new EmbedBuilder()
            .setTitle("📋 手動警告を発行")
            .setColor(0xFFAA00)
            .setDescription(
                `**対象**: <@${targetUser.id}>\n` +
                `**理由**: ${reason}\n` +
                `**発行者**: <@${interaction.user.id}>\n` +
                `**累計警告数**: ${totalWarnings}回`
            )
            .setTimestamp();
        await sendLog(interaction.guild, 'ng', logEmbed);

        await interaction.editReply(`✅ <@${targetUser.id}> に警告を発行しました。（理由: ${reason}）累計: **${totalWarnings}回**`);
    }

    if (sub === "list") {
        const res = await dbQuery(
            "SELECT reason, issued_by, created_at FROM warnings WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 10",
            [guildId, targetUser.id]
        );

        if (res.rows.length === 0) {
            return interaction.editReply(`ℹ️ <@${targetUser.id}> の警告履歴はありません。`);
        }

        const embed = new EmbedBuilder()
            .setTitle(`📋 ${targetUser.displayName} の警告履歴`)
            .setColor(0xFFAA00)
            .setDescription(
                res.rows.map((w, i) =>
                    `**${i + 1}.** ${w.reason}\n└ 発行者: <@${w.issued_by}> | ${new Date(w.created_at).toLocaleDateString("ja-JP")}`
                ).join("\n\n")
            )
            .setFooter({ text: `直近10件を表示` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }

    if (sub === "clear") {
        const res = await dbQuery(
            "DELETE FROM warnings WHERE guild_id = $1 AND user_id = $2",
            [guildId, targetUser.id]
        );

        await interaction.editReply(`✅ <@${targetUser.id}> の警告を **${res.rowCount}件** リセットしました。`);
    }
}
