import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("コマンド一覧を表示します。");

export async function execute(interaction) {
    const helpText = `**🛠️ Akatsuki Bot コマンド一覧 & 機能ガイド**

**📊 統計・分析 (Analytics)**
\`/vc top\` : 今月のVC滞在時間ランキングを表示
\`/vc user [target]\` : 指定ユーザーの滞在時間を表示
\`/activity\` : 機能詳細ページへのリンクを表示

**🛡️ 管理・設定 (Administration)**
\`/admin\` : Web管理画面へのリンクを発行
\`/setlog [channel] [type]\` : ログの送信先を設定
\`/aura\` : オーラ（自動ロール付与）システムの設定
\`/status\` : ボットの稼働状況を確認 (管理者のみ)

**🚫 モデレーション (Moderation)**
\`/ngword add/list\` : NGワードの追加・確認
\`/ngword remove/clear\` : NGワードの削除・全削除
\`/scan [type]\` : 過去ログのスキャン・復元 (Pro+)

**ℹ️ その他**
\`/help\` : コマンド一覧を表示`;

    await interaction.reply({ content: helpText });
}
