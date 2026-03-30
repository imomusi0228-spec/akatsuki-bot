# Replit デプロイ & 常時稼働ガイド

このボットを Replit で 24時間稼働させるための手順書です。

## 1. Replit へのインポート
1. Replit にログインし、**Create Repl** > **Import from GitHub** を選択します。
2. このリポジトリの URL を入力してインポートしてください。

## 2. 環境変数（Secrets）の設定
Replit の **Tools** > **Secrets** から、以下の変数を設定してください。
- `CLIENT_SECRET`: Discord OAuth2 Client Secret
- `PUBLIC_URL`: 外部アクセスのための完全なURL (例: `https://akatsukibot.duckdns.org`)
- `MANAGEMENT_API_URL`: 管理用APIのURL

---

## 🚀 構成別デプロイガイド

### 1. Oracle Cloud VM (OCI) + PM2 [推奨]
安定した運用環境として推奨される構成です。

#### サーバー接続
```bash
# SSHキーの場所を指定して接続:
ssh -i "path/to/your/ssh-key.key" ubuntu@your-server-ip
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

#### 更新手順（コマンドライン用）
以下のコマンドを実行することで、サーバー上のボットを最新の状態に更新し、再起動できます。
```bash
# ファイルの転送（必要に応じて）
scp -i "path/to/your/ssh-key.key" .env ubuntu@your-server-ip:~/akatsuki-bot/.env

# サーバーでの更新と再起動
ssh -i "path/to/your/ssh-key.key" ubuntu@your-server-ip "cd ~/akatsuki-bot && git pull && npm install && pm2 restart all"
```

### 2. Replit
1. GitHub からインポート。
2. **Tools > Secrets** に必要な環境変数を設定。
3. `Run` ボタンで起動。

### 3. Railway / Render
`Procfile` を使用してデプロイされます。各サービスの管理画面で環境変数を設定してください。
