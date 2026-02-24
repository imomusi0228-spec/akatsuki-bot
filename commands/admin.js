import { SlashCommandBuilder, MessageFlags, EmbedBuilder } from "discord.js";
import { ENV } from "../config/env.js";

export const data = new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Web管理画面の主要機能への案内を表示");

export async function execute(interaction) {
    const baseUrl = ENV.PUBLIC_URL || `http://localhost:${ENV.PORT}`;

    const embed = new EmbedBuilder()
        .setTitle("🏰 Akatsuki Bot 管理ポータル")
        .setDescription("すべての設定はWebダッシュボードから一括管理可能です。")
        .setColor(0x00ba7c)
        .addFields(
            { name: "📊 ダッシュボード", value: `[統計と概要を確認](${baseUrl}/admin/dashboard)`, inline: true },
            { name: "⚙️ サーバー設定", value: `[NGワード・ログ設定](${baseUrl}/admin/settings)`, inline: true },
            { name: "🛡️ アンチ・レイド", value: `[防衛・ロック設定](${baseUrl}/admin/antiraid)`, inline: true },
            { name: "🎫 チケット管理", value: `[チケット対応状況](${baseUrl}/admin/tickets)`, inline: true },
            { name: "🤖 AI分析", value: `[戦略レポート・インサイト](${baseUrl}/admin/ai)`, inline: true },
            { name: "🎨 外観・テーマ", value: `[ブランディング設定](${baseUrl}/admin/branding)`, inline: true }
        )
        .setFooter({ text: "※お嬢の指示により、管理コマンドはこちらに統合されました。" });

    await interaction.reply({
        embeds: [embed],
        flags: [MessageFlags.Ephemeral]
    });
}
