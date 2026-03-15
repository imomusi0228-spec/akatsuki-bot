# Replit デプロイ & 常時稼働ガイド

このボットを Replit で 24時間稼働させるための手順書だ。

## 1. Replit へのインポート
1. Replit にログインし、**Create Repl** > **Import from GitHub** を選択する。
2. このリポジトリの URL を入力してインポートしろ。

## 2. 環境変数（Secrets）の設定
Replit の **Tools** > **Secrets** から、以下の変数を設定するんだ。
- `CLIENT_SECRET`: Discord OAuth2 Client Secret
- `PUBLIC_URL`: 外部アクセスのための完全なURL (例: `https://akatsukibot.duckdns.org`)
- `MANAGEMENT_API_URL`: 管理用APIのURL

---

## 🚀 構成別デプロイガイド

### 1. Oracle Cloud VM (OCI) + PM2 [推奨]
お嬢が提供してくれた「完全手順」に基づいた、最も安定した運用方法だ。

#### サーバー接続
```bash
# お嬢の環境でのキーの場所はここだ: "C:\Users\dansy\Downloads\ssh-key-2026-03-13.key"
ssh -i "C:\Users\dansy\Downloads\ssh-key-2026-03-13.key" ubuntu@138.2.24.2
```

#### 環境構築 (Node.js 20.x)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

#### Botの配置と起動
```bash
git clone https://github.com/ユーザー名/リポジトリ名.git
cd akatsuki-bot
npm install
# .env を作成して設定
pm2 start index.js --name akatsuki-bot
pm2 startup
pm2 save
```

#### 更新手順（お嬢専用・コピペ用）
このコマンドを自分のPCのターミナルで叩けば、一発で更新が終わるようにしておいたよ。
```bash
# ファイルの転送（必要なら）
scp -i "C:\Users\dansy\Downloads\ssh-key-2026-03-13.key" .env ubuntu@138.2.24.2:~/akatsuki-bot/.env

# サーバーでの更新と再起動
ssh -i "C:\Users\dansy\Downloads\ssh-key-2026-03-13.key" ubuntu@138.2.24.2 "cd ~/akatsuki-bot && git pull && npm install && pm2 restart all"
```

### 2. Replit
1. GitHub からインポート。
2. **Tools > Secrets** に必要な環境変数を設定。
3. `Run` ボタンで起動。

### 3. Railway / Render
`Procfile` を使用してデプロイされる。管理画面で環境変数を設定しろ。
