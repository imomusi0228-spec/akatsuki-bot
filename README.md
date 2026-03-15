# Akatsuki Bot

Discord server management bot.

## 🛠️ コマンド一覧 & 機能ガイド

### 📊 統計・分析 (Analytics)
- `/vc top` : 今月のVC滞在時間ランキングを表示
- `/vc user [target]` : 指定ユーザーの滞在時間を表示
- `/activity` : 機能詳細ページへのリンクを表示

### 🛡️ 管理・設定 (Administration)
- `/admin` : Web管理画面へのリンクを発行
- `/setlog [channel] [type]` : ログの送信先を設定
- `/aura` : オーラ（自動ロール付与）システムの設定

### 🚫 モデレーション (Moderation)
- `/ngword add/list` : NGワードの追加・確認
- `/ngword remove/clear` : NGワードの削除・全削除
- `/scan [type]` : 過去ログのスキャン・復元 (Pro+)

### ℹ️ その他
- `/help` : コマンド一覧を表示


## 🚀 Deployment

### Railway / Render
`Procfile` が同梱されています。環境変数を設定してデプロイしてください。

### Replit
1. GitHub からインポート。
2. Secrets に必要な環境変数を設定。
3. 詳細な手順は [DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照。

## Scripts
- `npm start`: Start the bot
- `npm run register`: Register/Update slash commands
- `npm run maintenance`: Run maintenance tasks
