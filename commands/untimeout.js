import { ContextMenuCommandBuilder, ApplicationCommandType, PermissionFlagsBits, MessageFlags } from "discord.js";

export const data = new ContextMenuCommandBuilder()
    .setName("タイムアウトを解除")
    .setType(ApplicationCommandType.User)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction, db) {
    const targetUser = interaction.targetUser;
    const targetMember = interaction.targetMember;

    if (!targetMember) {
        return interaction.reply({ content: "❌ サーバー内にいないユーザーのタイムアウトは解除できません。", flags: MessageFlags.Ephemeral });
    }

    // ボットより上位の役職や所有者の場合、解除できない可能性がある
    if (!targetMember.moderatable) {
        return interaction.reply({ content: "❌ そのユーザーを管理する権限がボットにありません（役職の順序を確認してください）。", flags: MessageFlags.Ephemeral });
    }

    try {
        // タイムアウトを解除
        await targetMember.timeout(null, `${interaction.user.tag} による手動解除`);

        // 違反カウントもリセットする（親切設計）
        if (db) {
            await db.run(
                `DELETE FROM ng_hits WHERE guild_id = $1 AND user_id = $2`,
                interaction.guildId,
                targetUser.id
            ).catch(() => { });
        }

        return interaction.reply({ content: `✅ <@${targetUser.id}> のタイムアウトを解除しました。`, flags: MessageFlags.Ephemeral });
    } catch (e) {
        console.error("Untimeout context menu error:", e);
        return interaction.reply({ content: `❌ エラーが発生しました: ${e.message}`, flags: MessageFlags.Ephemeral });
    }
}
