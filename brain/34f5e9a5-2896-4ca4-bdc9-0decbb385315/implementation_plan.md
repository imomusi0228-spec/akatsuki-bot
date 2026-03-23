# 実装計画書: ポータブルULTIMATE（エキスパートライセンス）

ULTIMATE ティアを所持しているユーザーが、自身が管理する全てのサーバーでプレミアム機能（AI分析、高度な統計など）を利用できるようにするための実装計画です。

## 変更内容の概要

### [コアロジック]
#### [MODIFY] [subscription.js](file:///c:/Users/dansy/Desktop/Bot/core/subscription.js)
- `getUserTier(userId)` 関数を追加し、ユーザー個別の購読状況を確認できるようにします。
- `getSubscriptionInfo` を拡張し、ギルドのティアとユーザーのティアを比較して「実効ティア」を決定するようにします。

#### [MODIFY] [tiers.js](file:///c:/Users/dansy/Desktop/Bot/core/tiers.js)
- `getFeatures` 関数を修正し、`userTier` 引数を受け取れるようにします。これにより、ギルドが Free でもユーザーが ULTIMATE であれば上位機能のフラグを返します。

### [ルーティングとAPI]
#### [MODIFY] [admin.js](file:///c:/Users/dansy/Desktop/Bot/routes/admin.js)
- 管理画面へのアクセス時にユーザーティアを確認し、ギルドまたはユーザーのどちらかが要件を満たしていればアクセスを許可します。

#### [MODIFY] [api.js](file:///c:/Users/dansy/Desktop/Bot/routes/api.js)
- 統計 (`/api/stats`)、ヒートマップ、成長グラフなどの各APIでユーザーティアを考慮し、上位機能を解放します。

### [フロントエンド / UI]
#### [MODIFY] [views.js](file:///c:/Users/dansy/Desktop/Bot/services/views.js)
- 全てのレンダリング関数で `userTier` を EJS テンプレートに渡すようにします。

#### [MODIFY] [layout.ejs](file:///c:/Users/dansy/Desktop/Bot/views/layout.ejs)
- 画面上部のユーザー名の横に、ULTIMATE ユーザーであることを示すバッジを表示します。

#### [MODIFY] [dashboard.js](file:///c:/Users/dansy/Desktop/Bot/public/js/dashboard.js)
- ダッシュボードのプラン情報表示に、「Expert: ULTIMATE」などの表記を追加し、特典が適用されていることを明示します。

## 検証計画

### 自動テスト / 手動検証
- [ ] ULTIMATE ユーザーでログインし、Free サーバーの管理画面で AI 分析ページにアクセスできるか確認。
- [ ] 統計グラフが表示されるか確認。
- [ ] 一般ユーザー（Free）が同様の操作を行い、制限がかかることを確認。

## デプロイ
- 検証完了後、OCI サーバーへデプロイします。
