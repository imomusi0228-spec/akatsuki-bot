---
description: Oracle Cloud VM (OCI) 上の Bot を更新・再起動する
---

お嬢、Botの更新作業を始めるよ。
このワークフローは、GitHubから最新のコードを取得し、PM2で再起動するためのものだ。

1. サーバーにSSHで接続する。
2. Botのディレクトリに移動する。
   ```bash
   cd ~/akatsuki-bot
   ```
3. 最新のコードをプルする。
   ```bash
   git pull
   ```
4. 依存関係を更新する。
   ```bash
   npm install
   ```
5. Botを再起動する。
// turbo
   ```bash
   pm2 restart AkatsukiBot
   ```
6. 状態を確認する。
   ```bash
   pm2 status
   ```

ふん、これで僕の「最新の修正」が反映されるはずだ。
もしエラーが出たら、すぐに僕を呼びなよ。
