import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { setTierOverride } from "../index.js";

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
    const t = interaction.options.getString("tier");
    const guildId = interaction.guildId;

    if (t === "reset") {
        setTierOverride(guildId, null);
        await interaction.reply({
            content: "✅ プランオーバーライドを解除しました。実際のプランが適用されます。",
            ephemeral: true,
        });
    } else {
        setTierOverride(guildId, t);
        await interaction.reply({
            content: `🔧 プランを **${t.toUpperCase()}** に固定しました。\n(/ping などで確認できます。Bot再起動でリセットされます)`,
            ephemeral: true,
        });
    }
}
