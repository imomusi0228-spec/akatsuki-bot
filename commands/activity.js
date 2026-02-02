import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("activity")
    .setDescription("VC不参加や活動状況をチェックします")
    .addSubcommand((s) =>
        s
            .setName("config")
            .setDescription("判定設定を行います")
            .addIntegerOption((o) => o.setName("weeks").setDescription("VC不参加判定（週間）").setMinValue(1))
            .addChannelOption((o) => o.setName("intro_channel").setDescription("自己紹介チャンネル（発言確認用）"))
            .addRoleOption((o) => o.setName("role").setDescription("チェック対象の特定ロール"))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

async function getConfig(db, guildId) {
    const row = await db.get("SELECT * FROM settings WHERE guild_id=$1", guildId);
    return {
        weeks: row?.activity_weeks || 4,
        introChId: row?.intro_channel_id,
        targetRoleId: row?.target_role_id,
    };
}

async function setConfig(db, guildId, { weeks, introChId, targetRoleId }) {
    await db.run(
        `INSERT INTO settings (guild_id, activity_weeks, intro_channel_id, target_role_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id) DO UPDATE SET
       activity_weeks = COALESCE($2, settings.activity_weeks),
       intro_channel_id = COALESCE($3, settings.intro_channel_id),
       target_role_id = COALESCE($4, settings.target_role_id)`,
        guildId,
        weeks,
        introChId,
        targetRoleId
    );
}

import { isTierAtLeast } from "../utils/common.js";

export async function execute(interaction, db) {
    if (!db) return interaction.reply({ content: "❌ データベースに接続できていません。", flags: MessageFlags.Ephemeral });

    // Check Tier: Pro or Higher required
    const tier = interaction.userTier || "free";
    if (!isTierAtLeast(tier, "pro")) {
        return interaction.reply({ content: "🔒 この機能は **Proプラン** 以上で利用可能です。", flags: MessageFlags.Ephemeral });
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "config") {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const weeks = interaction.options.getInteger("weeks");
        const introCh = interaction.options.getChannel("intro_channel");
        const role = interaction.options.getRole("role");

        await setConfig(db, guild.id, {
            weeks: weeks,
            introChId: introCh?.id,
            targetRoleId: role?.id,
        });

        const conf = await getConfig(db, guild.id);
        const rules = [];
        rules.push(`・VC不参加判定: **${conf.weeks}** 週間以内なし`);
        rules.push(`・自己紹介確認: ${conf.introChId ? `<#${conf.introChId}>` : "未設定"}`);
        rules.push(`・必須ロール確認: ${conf.targetRoleId ? `<@&${conf.targetRoleId}>` : "未設定"}`);

        return interaction.editReply(`✅ 設定を更新しました。\n\n${rules.join("\n")}`);
    }
}
