import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("コマンド一覧を表示します。");

export async function execute(interaction) {
    const embed = new EmbedBuilder()
        .setTitle("🛠️ Akatsuki Bot コマンド一覧 & 機能ガイド")
        .setDescription("利用可能なコマンドの一覧です。")
        .setColor(0x0099FF)
        .addFields(
            {
                name: "📊 統計・分析 (Analytics)",
                value: "`/vc top`: 今月のVC滞在時間ランキングを表示\n`/vc user [target]`: 指定ユーザーの滞在時間を表示\n`/activity`: 機能詳細ページへのリンクを表示",
                inline: false
            },
            {
                name: "🛡️ 管理・設定 (Administration)",
                value: "`/admin`: Web管理画面へのリンクを発行\n`/setlog [channel] [type]`: ログの送信先を設定\n`/aura`: オーラ（自動ロール付与）システムの設定\n`/status`: ボットの稼働状況を確認 (管理者のみ)",
                inline: false
            },
            {
                name: "🚫 モデレーション (Moderation)",
                value: "`/ngword add/list`: NGワードの追加・確認\n`/ngword remove/clear`: NGワードの削除・全削除\n`/scan [type]`: 過去ログのスキャン・復元 (Pro+)",
                inline: false
            },
            {
                name: "ℹ️ その他",
                value: "`/help`: このヘルプを表示",
                inline: false
            }
        )
        .setFooter({ text: "Akatsuki Bot System" });

    await interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
}
