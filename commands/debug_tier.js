import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { setTierOverride } from "../service/license.js";

export const data = new SlashCommandBuilder()
    .setName("debug_tier")
    .setDescription("[Dev] 検証用にBotのプラン認識を一時的に変更します")
    .addStringOption((o) =>
        o
            .setName("tier")
            .setDescription("シミュレートするプラン")
            .setRequired(true)
            .addChoices(
                { name: "RESET (Real)", value: "reset" },
                { name: "Free", value: "free" },
                { name: "Pro", value: "pro" },
                { name: "Pro+", value: "pro_plus" }
            )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
    const ALLOWED_GUILD_ID = "1467338822051430572";

    if (interaction.guildId !== ALLOWED_GUILD_ID) {
        return interaction.reply({
            content: "🚫 このコマンドはこのサーバーでは使用できません。",
            flags: MessageFlags.Ephemeral,
        });
    }

    const t = interaction.options.getString("tier");
    const guildId = interaction.guildId;

    if (t === "reset") {
        setTierOverride(guildId, null);
        await interaction.reply({
            content: "✅ プランオーバーライドを解除しました。実際のプランが適用されます。",
            flags: MessageFlags.Ephemeral,
        });
    } else {
        setTierOverride(guildId, t);
        await interaction.reply({
            content: `🔧 プランを **${t.toUpperCase()}** に固定しました。\n(/ping などで確認できます。Bot再起動でリセットされます)`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
