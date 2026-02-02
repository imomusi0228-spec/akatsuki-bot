import { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder } from "discord.js";

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
    .addSubcommand((s) => s.setName("list").setDescription("不参加・未活動メンバーのリストを生成します"))
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

import { isTierAtLeast, checkActivityStats } from "../index.js";

export async function execute(interaction, db) {
    // Check Tier: Pro or Higher required
    const tier = interaction.userTier || "free";
    if (!isTierAtLeast(tier, "pro")) {
        return interaction.reply({ content: "🔒 この機能は **Proプラン** 以上で利用可能です。", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "config") {
        await interaction.deferReply({ ephemeral: true });

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

    if (sub === "list") {
        await interaction.deferReply();

        try {
            const { config, data } = await checkActivityStats(guild, db);

            if (data.length === 0) {
                return interaction.editReply(`✅ 対象期間（${config.weeks}週間）未利用のメンバーはいませんでした。`);
            }

            // CSV format
            const reportRows = [];
            // Header
            reportRows.push(["User ID", "Username", "DisplayName", "Last VC Date", "Has Target Role", "Intro Post (Recent)"]);

            data.forEach(r => {
                reportRows.push([
                    r.user_id,
                    r.username,
                    r.display_name,
                    r.last_vc,
                    r.has_role,
                    r.has_intro
                ]);
            });

            const csvContent = reportRows.map(row => row.map(c => `"${c}"`).join(",")).join("\n");
            const buffer = Buffer.from(csvContent, "utf-8"); // BOM needed?
            const bufferWithBom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), buffer]);

            const attachment = new AttachmentBuilder(bufferWithBom, { name: `inactive_users_${config.weeks}w.csv` });

            await interaction.editReply({
                content: `✅ **スキャン完了**\n条件: ${config.weeks}週間以内のVC利用なし\n対象人数: ${data.length}人\n完了しました。`,
                files: [attachment]
            });
        } catch (e) {
            console.error(e);
            await interaction.editReply("❌ エラーが発生しました: " + e.message);
        }
    }
}
