import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";


// Owner check helper (Replace with your own ID or implement admin check)
// Since we don't have a secure way to know "Seller" vs "Buyer" easily unless hardcoded or using Bot Owner via API.
// For now, we restrict 'add' to Administrator permission, but ideally it should be restricted to the Bot Owner (process.env.OWNER_ID?)
// User says "Selling the bot", so they probably host it themselves?
// Or if they sell the *code* and the buyer hosts it, then the buyer is the owner.
// If the user hosts ONE instance and sells ACCESS, then ONLY the user should run 'add'.
// We will assume "Host Owner" controls it.
// We'll use a hardcoded check for a specific User ID if provided in env, else fallback to Admin but warn.
const OWNER_ID = process.env.OWNER_ID;

export const data = new SlashCommandBuilder()
    .setName("license")
    .setDescription("ライセンス情報の確認・管理")
    .addSubcommand(s => s.setName("status").setDescription("現在のライセンスステータスを確認"))
    .addSubcommand(s =>
        s.setName("add").setDescription("[Owner Only] ライセンスを付与します")
            .addStringOption(o => o.setName("guild_id").setDescription("対象サーバーID").setRequired(true))
            .addIntegerOption(o => o.setName("days").setDescription("有効日数 (0=無期限)").setRequired(true))
            .addStringOption(o => o.setName("tier").setDescription("プラン (Free/Pro/Pro+)")
                .addChoices(
                    { name: "Free", value: "free" },
                    { name: "Pro", value: "pro" },
                    { name: "Pro+", value: "pro_plus" }
                )
            )
            .addStringOption(o => o.setName("note").setDescription("メモ").setRequired(false))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages); // Allow check for everyone? Or Admin? Status check is fine for all.

export async function execute(interaction, db) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === "status") {
        const isFree = (process.env.FREE_GUILD_IDS || "").includes(guild.id);
        let dbLic = null;
        let valid = false;

        if (db) {
            dbLic = await db.get("SELECT * FROM licenses WHERE guild_id=$1", guild.id);
        }

        let tier = "free";
        if (isFree) {
            valid = true;
            tier = "pro_plus (whitelist)";
        } else if (dbLic) {
            if (!dbLic.expires_at || Number(dbLic.expires_at) > Date.now()) {
                valid = true;
                tier = dbLic.tier || "free";
            }
        }

        const type = isFree ? "Free Tier (Whitelist)" : (dbLic ? `License: ${tier.toUpperCase()}` : "No License");
        let expireStr = "なし";
        if (dbLic?.expires_at) {
            expireStr = new Date(Number(dbLic.expires_at)).toLocaleString("ja-JP");
        } else if (isFree || (dbLic && !dbLic.expires_at)) {
            expireStr = "無期限";
        }

        const color = valid ? 0x00ff00 : 0xff0000;
        const statusText = valid ? "✅ 有効 (Active)" : "🚫 無効 (Inactive)";

        // Tier Emoji
        const tierLabel = tier.includes("pro_plus") ? "🟣 Pro+" : (tier.includes("pro") ? "🟢 Pro" : "⚪ Free");

        await interaction.reply({
            embeds: [{
                title: "License Status",
                color: color,
                fields: [
                    { name: "Server ID", value: guild.id, inline: true },
                    { name: "Plan", value: tierLabel, inline: true },
                    { name: "Status", value: statusText, inline: true },
                    { name: "Expires", value: expireStr, inline: false },
                    { name: "Note", value: dbLic?.note || "-", inline: false }
                ]
            }]
        });
        return;
    }

    if (sub === "add") {
        // Owner Check
        if (OWNER_ID && interaction.user.id !== OWNER_ID) {
            return interaction.reply({ content: "❌ このコマンドはBot管理者のみ実行可能です。", ephemeral: true });
        }
        // Fallback check
        if (!OWNER_ID && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "❌ 管理者権限が必要です。", ephemeral: true });
        }

        const targetGid = interaction.options.getString("guild_id");
        const days = interaction.options.getInteger("days");
        const tier = interaction.options.getString("tier") || "free";
        const note = interaction.options.getString("note") || "";

        let expires = null;
        if (days > 0) {
            expires = Date.now() + (days * 24 * 60 * 60 * 1000);
        }

        await db.run(
            `INSERT INTO licenses (guild_id, expires_at, tier, notes) VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id) DO UPDATE SET expires_at=$2, tier=$3, notes=$4`,
            targetGid, expires, tier, note
        );

        await interaction.reply({ content: `✅ ライセンスを登録しました。\nTarget: ${targetGid}\nPlan: ${tier}\nDays: ${days}\nExpires: ${expires ? new Date(expires).toLocaleString() : "無期限"}` });
    }
}

