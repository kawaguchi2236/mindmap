# ADR-002 クエリレイヤ（ORM を使うか）

- ステータス: 採用
- 決定日: 2026-09-13
- 決定者: 担当 B（認証・クラウド）
- 備考: task.md §0.4 では担当 A の宿題だったが、Neon アクセス実装に必要なため B が先に決めた。A は重複して書かないこと。

## 決定

ORM は使わず、**`@neondatabase/serverless` のタグ付きテンプレートによる素の SQL** を使う。
マイグレーションは `src/lib/server/migrations/*.sql` に連番の SQL を置き、手動適用する。

## 理由

- Phase 1 のサーバ側スキーマは User / Map / Node と Auth.js 用テーブルのみで、ORM の恩恵が小さい。
- Cloudflare Workers ランタイム（ADR-001: `@opennextjs/cloudflare`）で確実に動く。Neon の HTTP ドライバはコネクション前提を持たない。
- Drizzle / Prisma は Workers 対応のために追加設定・追加バンドルが必要で、CLAUDE.md §37「不要な抽象を作らない」に反する。
- `@auth/neon-adapter` が `@neondatabase/serverless` を直接前提にしており、認証と同じ接続で統一できる。
- タグ付きテンプレートは値を自動でパラメータ化するため、SQL インジェクション対策は満たせる（文字列連結で SQL を組み立てないこと）。

## 却下した案

- **Drizzle ORM**: 型安全は魅力だが、Phase 1 の規模では設定コストとバンドル増が上回る。スキーマが増えたら再評価する。
- **Prisma**: Workers では別エンジン／アダプタが要る。運用コストが Phase 1 に見合わない。

## 再評価の条件

- テーブルが 8 個を超える、または複雑な JOIN／集計が増えたとき
- マイグレーション履歴の管理が手動 SQL では破綻したとき
