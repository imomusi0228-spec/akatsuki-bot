# 最終フェーズ：ポータブルULTIMATE（エキスパートライセンス）の実装

- [x] ポータブルULTIMATEアクセス（Expert License）のコア実装
    - [x] `core/subscription.js` に `getUserTier` を追加し、ユーザー単位のティア取得を可能にする
    - [x] `core/tiers.js` の `getFeatures` を修正し、ユーザーティアを考慮した機能解放に対応
    - [x] `routes/admin.js` と `routes/api.js` を修正し、ユーザーティアに基づいたアクセス制御とデータ提供を行う
    - [x] `services/views.js` を修正し、全ての管理画面テンプレートに `userTier` と `TIERS` を渡す
- [x] UI/UXの強化
    - [x] `views/layout.ejs` に「ULTIMATE」バッジを表示（エキスパートユーザーの識別）
    - [x] `public/js/dashboard.js` のプラン表示を Expert License 対応に更新
- [ ] 動作確認と最終調整
    - [ ] ULTIMATE ユーザーが自身の管理する Free サーバーでプレミアム機能を使えるかテスト
    - [ ] 一般ユーザーに影響がないことを確認
- [ ] OCI デプロイ
    - [ ] `/deploy-oci` ワークフローの実行
