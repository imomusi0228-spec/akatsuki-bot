import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
    .setName("help")
    .setDescription("コマンド一覧を表示します。");

export async function execute(interaction) {
    const helpText = `**🛠️ Akatsuki Bot コマンド一覧 & 機能ガイド**

**📊 統計・分析 (Analytics)**
\`/vc top\` : 今月のVC滞在時間ランキングを表示
\`/vc user [target]\` : 指定ユーザーの滞在時間を表示
\`/level [target]\` : レベルと経験値（XP）を表示
\`/activity\` : 機能詳細ページへのリンクを表示

**🛡️ 管理・設定 (Administration)**
\`/admin\` : Web管理画面へのリンクを発行
\`/setlog [channel] [type]\` : ログの送信先を設定
\`/aura\` : オーラ（自動ロール付与）システムの設定

**🚫 モデレーション (Moderation)**
\`/ngword add/list\` : NGワードの追加・確認
\`/report [user] [reason]\` : メンバーをモデレーターに報告
\`/ticket setup\` : チケット作成パネルを設置
\`/rr add/list/remove\` : リアクションロールの設定
\`/warn issue/list\` : 警告の発行・履歴確認 (運営専用)
\`/scan [type]\` : 過去ログのスキャン・復元 (Pro+ 限定)

**ℹ️ その他**
\`/help\` : コマンド一覧を表示`;

    await interaction.reply({ content: helpText });
}
