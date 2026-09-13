# ADR-002: ORM / クエリ層

## ステータス

採用（2026-09-13）

前提は [ADR-001](./ADR-001-cloudflare-nextjs.md) の決定（Cloudflare Workers + `@opennextjs/cloudflare` + Neon PostgreSQL）。

---

## 背景

Phase 1 のクラウド側スキーマは `User` / `Map` / `Node` の 3 テーブルのみ（`CLAUDE.md` §7）。Edge は `Node.parent_id` から導出するので永続化しない。クエリも同期 API が投げる単純な select / upsert / 論理削除が中心で、複雑な join や集計はない。

一方でランタイムは Cloudflare Workers という制約の強い環境であり、`CLAUDE.md` §19 / §32 ADR-002 は「Cloudflare ランタイム互換性・Neon 互換性・マイグレーション運用・型安全性・バンドル/ランタイムのオーバーヘッド・保守負荷」で判断せよと定めている。また §37 は「ランタイム互換性を検証する前に Prisma/Drizzle を入れるな」と明示している。

候補は Drizzle ORM と Prisma の 2 つに絞る（`CLAUDE.md` §32「最初の候補で結論が出たら 5 つ以上調べない」）。

---

## 調査結果

調査日: 2026-09-13。バージョンは npm registry の dist-tags を直接参照して確認した。

### 1. バージョンの実態

| パッケージ | dist-tag `latest` | 備考 |
|---|---|---|
| `drizzle-orm` | **0.45.2**（2026-03-27） | `beta = 1.0.0-beta.22`、`rc = 1.0.0-rc.4`。v1 は RC 段階（`1.0.0-rc.5-*` が 2026-09-09） |
| `prisma` | **8.0.0-rc.14**（2026-09-12） | dist-tag `latest` が **RC を指している**。安定版は `prev = 7.10.0`（2026-08-25） |
| `@auth/drizzle-adapter` | **1.11.3**（2026-07-20） | Auth.js 公式アダプタ |
| `@opennextjs/cloudflare` | 1.20.6 | ADR-001 参照 |

注意すべき点が 2 つある。

- **Drizzle は 0.x のまま**。ただし 0.45.2 が実質の安定リリースとして広く使われており、v1 は RC まで来ている。0.x 表記だが破壊的変更は CHANGELOG で管理されている
- **Prisma の `latest` が RC を指している**のは異常な状態で、`npm i prisma` が 8.0.0-rc.14 を引く。安定版を使うなら `prisma@7.10.0` を明示的にピン留めする必要がある

### 2. Cloudflare Workers 互換性

**Prisma**（公式ドキュメント — https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare、ページ上のバージョン表記 v7.10.0）

- **driver adapter が必須**。Neon なら `@prisma/adapter-neon` を入れて HTTP 経由でアクセスする
- 通常の PostgreSQL（`pg` ドライバ）でデプロイする場合は `wrangler.toml` に `node_compat = true` が必要。ただし **Cloudflare Pages では正式サポートされていない**と明記
- **「Cloudflare has a size limit of 3 MB for Workers on the free plan」** と公式に注意書きがあり、超えた場合は有料プランへのアップグレードを推奨している
- コード生成（`prisma generate`）のステップがデプロイパイプラインに入る

**Drizzle**

- Neon serverless driver（`drizzle-orm/neon-http` / `neon-serverless`）および `node-postgres`（`drizzle-orm/node-postgres`）で Workers 上をネイティブに動く。バイナリ依存ゼロ
- OpenNext 公式の DB ガイドが **Drizzle のコード例をそのまま載せている**（Hyperdrive + `pg` + `drizzle-orm/node-postgres`、`maxUses: 1`、`cache()` でリクエストスコープ化）— https://opennext.js.org/cloudflare/howtos/db
  → ADR-001 で採用した構成における「公式の想定形」が Drizzle である
- コード生成ステップなし。スキーマは TypeScript ファイルがそのまま真実の源

### 3. バンドルサイズ

- Drizzle: 約 **7 KB**（min+gzip）、バイナリ依存なし
- Prisma: 7.x で 14 MB → 1.6 MB まで削減されたが、依然として Drizzle の約 85 倍
- 初期化コストも Drizzle 10–20 ms 相当に対し Prisma は 90 ms 相当という比較が複数のベンチで報告されている

ADR-001 で確認した通り **Workers Free プランは CPU 10 ms / 呼び出し、バンドル 3 MB** という制約があり、Prisma のランタイム初期化コストとサイズは両方の上限に直接効いてくる。

参照: https://www.bytebase.com/blog/drizzle-vs-prisma/ 、 https://makerkit.dev/blog/tutorials/drizzle-vs-prisma （いずれも二次情報。バンドルサイズと初期化時間の数値はこれらの比較記事による）

### 4. マイグレーション運用

- **Drizzle**: `drizzle-kit generate` で TypeScript スキーマから SQL マイグレーションファイルを生成し、`drizzle-kit migrate` で適用。生成される SQL をそのままレビュー・編集できる。`drizzle-kit` は devDependency なので Worker バンドルに入らない
- **Prisma**: `prisma migrate dev` / `deploy`。ワークフローは成熟しているが、`schema.prisma` という独自 DSL + `prisma generate` によるクライアント生成が必須

`CLAUDE.md` §6 は「本番テーブルを自動で drop しない」「破壊的マイグレーションを明示せずに走らせない」と定めている。**生成された SQL を目視レビューしてから適用できる Drizzle のフローの方が、このルールを守りやすい。**

### 5. Auth.js アダプタ

両方に公式アダプタが存在する。

- `@auth/drizzle-adapter` — https://authjs.dev/getting-started/adapters/drizzle
  - PostgreSQL / MySQL / SQLite に対応。PostgreSQL 用のスキーマ例が公式ドキュメントに掲載されている
  - テーブル: `usersTable` / `accountsTable` / `sessionsTable`（DB セッション戦略時のみ必須）/ `verificationTokensTable`（**Magic Link プロバイダ使用時に必須**）
  - インストール: `npm install drizzle-orm @auth/drizzle-adapter` / `npm install -D drizzle-kit`
- `@auth/prisma-adapter` も同様に公式提供されている

`CLAUDE.md` §14 は「Magic Link 等の低摩擦なパスワードレス方式を優先」としているため、`verificationTokensTable` は必須になる。

### 6. 型安全性・保守性

- Drizzle: SQL に近い API。`select().from().where()` がそのまま SQL の構造に対応し、生成されるクエリが読める。型はスキーマ定義から推論される
- Prisma: 宣言的で読みやすく、リレーション取得（`include`）が簡潔。大規模スキーマや複雑な join では有利

Phase 1 は 3 テーブル・単純クエリなので、**Prisma の抽象度が効く場面がない**。

---

## 決定

**Drizzle ORM を採用する。**

- `drizzle-orm@^0.45.2`（dist-tag `latest`。**v1 の RC は使わない**）
- `drizzle-kit@latest`（devDependency）
- `@auth/drizzle-adapter@^1.11.3`
- ドライバ: Phase 1 は `drizzle-orm/neon-http` + `@neondatabase/serverless`。Hyperdrive へ移行する場合は `drizzle-orm/node-postgres` + `pg` に差し替える（ADR-001 の決定に従う）
- スキーマ定義は `src/lib/db/schema.ts` の 1 ファイルに集約（User / Map / Node + Auth.js の 4 テーブル）

---

## 理由

1. **ADR-001 の構成における公式の想定形が Drizzle。** OpenNext の Cloudflare DB ガイドが Drizzle のコード例を載せており、Hyperdrive・`maxUses: 1`・リクエストスコープ化といった Workers 固有の落とし穴に対する答えがそのまま手に入る。Prisma でこの構成を組むと、driver adapter + `node_compat` + 3 MB 制約を自力で通すことになる。
2. **Free プランの制約に直接効く。** 7 KB とバイナリ依存ゼロは、CPU 10 ms / バンドル 3 MB という ADR-001 で確認した上限に対する安全マージンそのもの。Prisma 公式が自ら 3 MB 制約を警告している時点で、無料枠での運用には向かない。
3. **規模が釣り合っている。** 3 テーブル・単純クエリに Prisma の抽象度は過剰。`CLAUDE.md` §37「最小の正しい実装が勝つ」に照らして Drizzle が妥当。
4. **データ安全性のルールを守りやすい。** `drizzle-kit generate` が出す SQL をレビューしてから適用できるので、§6 の「破壊的マイグレーションを明示せずに走らせない」を運用に落とし込める。
5. **バージョンの安定性。** Prisma の dist-tag `latest` が RC（8.0.0-rc.14）を指している現状は、`npm i` の結果が RC になるという地雷を含む。Drizzle 0.45.2 は素直に安定版が取れる。
6. **Auth.js 公式アダプタがあり、Magic Link に必要な `verificationTokensTable` を含む PostgreSQL スキーマ例が公式ドキュメントに掲載されている。** 認証まわりを自作しなくてよい。

---

## 影響（実装側がやらなければならないこと）

- [ ] `drizzle-orm` は **`^0.45.2` を明示的にピン留め**する。`drizzle-orm@beta` / `@rc`（1.0.0 系）は Phase 1 では使わない
- [ ] スキーマは `User` / `Map` / `Node` + Auth.js 必須テーブル（`users` / `accounts` / `sessions` / `verificationTokens`）を 1 ファイルにまとめる。`CLAUDE.md` §7 の `Map.version`・`updated_at`・`deleted_at` を同期で使うため必ず含める。**Edge テーブルは作らない**（`Node.parent_id` から導出）
- [ ] Auth.js のユーザーテーブルと `CLAUDE.md` §7 の `User` を**二重に作らない**。Auth.js アダプタの `usersTable` を `User` として扱い、`Map.user_id` はそこを参照する
- [ ] マイグレーションは `drizzle-kit generate` で SQL を生成 → **生成 SQL を目視レビュー** → `drizzle-kit migrate` で適用、という手順を固定する。CI で自動適用しない
- [ ] `drizzle-kit` は devDependency に入れ、Worker バンドルに含まれないことを `@opennextjs/cloudflare build` の出力で確認する
- [ ] DB クライアントをモジュールトップレベルで生成しない（ADR-001 の実装ルールと同じ）
- [ ] Stage 6（クラウド同期）の前に `CLAUDE.md` §13 の同期判断テーブルを書き、Drizzle のクエリではなく**純粋関数**としてユニットテストする。ORM 選択が同期ロジックのテスト容易性に影響しないようにする

---

## 却下した選択肢

### Prisma（`prisma@7.10.0` 安定版 / `@prisma/adapter-neon`）

DX とマイグレーションツールの成熟度では優れており、大規模スキーマなら有力。しかし本プロジェクトでは以下の理由で却下する。

- ランタイムサイズが Drizzle の約 85 倍（7.x で 1.6 MB まで縮んだが依然大きい）。**Prisma 公式ドキュメント自身が Cloudflare Free プランの 3 MB Worker サイズ上限を警告している**
- 初期化コストが Workers Free プランの CPU 10 ms / 呼び出しに対して重い
- driver adapter + `node_compat` の設定が必要で、Drizzle より手順が多い
- `prisma generate` のコード生成ステップがビルドパイプラインに増える
- dist-tag `latest` が RC（8.0.0-rc.14）を指しており、安定版を使うには明示的なピン留めが要る
- 3 テーブル・単純クエリという規模に対して抽象度が過剰

### 素の SQL（`@neondatabase/serverless` の `sql` テンプレートのみ）

依存が最小で最速。しかしスキーマからの型推論が得られず、マイグレーション管理を自作することになる。`CLAUDE.md` §38 は「TypeScript の安全性を犠牲にして速く進むな」「`any` を広く使うな」と定めており、手書き SQL + 手書き型定義は同期処理のような壊れやすい箇所でこのルールに反する。Auth.js アダプタも自作が必要になる。却下。

### Kysely / その他のクエリビルダ

Drizzle で要件が満たせているため、`CLAUDE.md` §32 の「最初の候補で結論が出たら 5 つ以上調べない」に従い調査しない。

---

## 参照 URL

- https://www.prisma.io/docs/orm/prisma-client/deployment/edge/deploy-to-cloudflare
- https://opennext.js.org/cloudflare/howtos/db
- https://authjs.dev/getting-started/adapters/drizzle
- https://neon.com/docs/guides/cloudflare-workers
- https://developers.cloudflare.com/workers/platform/limits/
- https://www.bytebase.com/blog/drizzle-vs-prisma/ （二次情報。バンドルサイズ比較）
- https://makerkit.dev/blog/tutorials/drizzle-vs-prisma （二次情報。初期化コスト比較）
- npm registry dist-tags（2026-09-13 時点で直接取得）: `drizzle-orm@0.45.2`（`rc = 1.0.0-rc.4`）/ `prisma@8.0.0-rc.14`（`prev = 7.10.0`）/ `@auth/drizzle-adapter@1.11.3`
