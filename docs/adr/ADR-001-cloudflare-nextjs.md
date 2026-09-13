# ADR-001: Cloudflare 上で Next.js を動かす方法

## ステータス

採用（2026-09-13）

ただし「§ 影響」の検証項目（Worker サイズ上限・Free プラン CPU 時間）を Stage 1 で実測し、結果によっては再評価する。

---

## 背景

Web MindMap は Phase 1 で以下を要求している（`CLAUDE.md` §4, §34）。

- Next.js + React + TypeScript
- Cloudflare ホスティング
- Auth.js による Google / Email 認証
- Neon PostgreSQL へのクラウド同期
- 初期運用コストを低く抑える（無料枠内で開始）
- 無料ユーザー向けに広告を出す = **商用利用**

「Cloudflare に Next.js をデプロイする」方法は 2024〜2026 の間に 3 回変わっており（`next-on-pages` → `@opennextjs/cloudflare` → `vinext`）、記憶で実装すると確実に古い手順になる。実装を始める前に、現時点で何が公式の道筋かを確定させる必要がある。

---

## 調査結果

調査日: 2026-09-13。バージョンは npm registry の dist-tags を直接参照して確認した。

### 1. Cloudflare が現在推奨する方法は `vinext`（ただし beta）

Cloudflare Workers の公式フレームワークガイドは、**vinext を新規 Next.js アプリのデフォルト**として推奨している。

> "Cloudflare recommends vinext as the default way to run Next.js applications on Cloudflare Workers."
> — https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/

vinext は Next.js の API サーフェスを Vite 上で再実装した Cloudflare 製の OSS Vite プラグイン。

- 公式サイトの表記: 「94% of the Next.js 16 API surface」をカバー。カバレッジと制限は公開ダッシュボードで追跡中 — https://vinext.dev/
- README: "Under active development"、"not yet a drop-in replacement for every application"、**Next.js 16.x のみ対応** — https://github.com/cloudflare/vinext
- 非対応として明示されているもの: `"use cache"` / Cache Components の部分実装、ビルド時の画像・フォント最適化、App Router dev でのネイティブモジュール、`runtime` / `preferredRegion` のルート設定は無視される
- **npm 最新版: `vinext@1.0.0-beta.9`（2026-09-02 公開）** — dist-tag `latest` が beta を指している = 安定版未リリース

### 2. `@opennextjs/cloudflare` は安定版で、公式ドキュメントにも残っている

- Cloudflare 公式の OpenNext アダプタページは現存し、手順が維持されている。ただし位置づけは「既存アプリ向け」で、"Migrate to vinext when compatibility allows" と書かれている — https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- **npm 最新版: `@opennextjs/cloudflare@1.20.6`（2026-09-02 公開）** — 安定版として活発にメンテされている
- 対応 Next.js: **16 の全マイナー/パッチ、14 と 15 の最新マイナー**。Next.js 14 のサポートは 2026 Q1 に終了予定 — https://opennext.js.org/cloudflare
- 対応機能: App Router / Pages Router、Route Handlers、動的ルート、SSG/SSR、Middleware、ISR、PPR、画像最適化、Turbopack
- **唯一の非対応: Node.js Middleware（Next.js 15.2 で導入されたもの）**
- 必須設定: `nodejs_compat` 互換性フラグを ON、`compatibility_date` を **2024-09-23 以降**に設定。`.open-next/assets` を `ASSETS` バインディングに割り当てる
- 重要な性質: Edge ランタイムではなく **Node.js ランタイム**で動く（`next-on-pages` との最大の違い）。依存ツリー内の全パッケージが Workers ランタイムでネイティブに動くか `nodejs_compat` 経由で動く必要がある

### 3. Cloudflare Pages + `next-on-pages` は終了

- `@cloudflare/next-on-pages` は deprecated / archived。対応は Next.js 13–14 止まり — https://github.com/cloudflare/next-on-pages
- Cloudflare Pages のフレームワークガイドも、フルスタック Next.js（SSR / RSC / Server Actions / Route Handlers / Middleware）は Workers 上の vinext を使えと案内している。Pages に残るのは **静的エクスポート（`output: 'export'`）のみ** — https://developers.cloudflare.com/pages/framework-guides/nextjs/

### 4. Auth.js (NextAuth v5) の動作

- **`next-auth` の npm dist-tags: `latest = 4.24.15`、`beta = 5.0.0-beta.32`（2026-07-20 公開）。v5 は今日時点でもまだ beta である。** 「v5 が安定版になった」と書くブログ記事が複数あるが、レジストリの事実と一致しない
- Auth.js 公式のデプロイガイドがホスティング環境を自動判定する環境変数は `VERCEL` と `CF_PAGES` のみ。**Cloudflare Workers は明示的に列挙されていない** — https://authjs.dev/getting-started/deployment
  → Workers では `AUTH_TRUST_HOST=true`（または設定の `trustHost: true`）を明示する必要がある
- v5 の設定分割（edge-safe な `auth.config.ts` と、DB アダプタを含む `auth.ts`）は、Middleware を edge 側に置いたまま DB アダプタを使うための正規パターン — https://authjs.dev/getting-started/migrating-to-v5
- OpenNext 側の制約として `next/headers` の `cookies()` は Node.js 専用であり、**`middleware.ts` の中でセッション処理に使うと Workers では動かない**。Middleware では JWT セッション戦略（`auth.config.ts` 側）に留め、DB を触る処理は Route Handler / Server Component 側に置く必要がある
- OpenNext は Node.js ランタイムで動き `nodejs_compat` が有効なので、Auth.js が要求する Node API（`crypto` 等）は原則利用できる

### 5. Neon PostgreSQL への接続

Neon 公式の Cloudflare Workers ガイド — https://neon.com/docs/guides/cloudflare-workers

- **推奨は Hyperdrive**: "Hyperdrive is the recommended approach as it provides optimized connection pooling and fast query routing"。Cloudflare のネットワーク側で接続プーリングを行う
- **Hyperdrive を使う場合は `node-postgres (pg)` や `postgres.js` などネイティブドライバを使い、Neon serverless driver は使わない**（明示的な警告あり）
- Hyperdrive を使わない場合の選択肢が `@neondatabase/serverless`（npm 最新 `1.1.0`）。HTTP ドライバは単発クエリ向けで低レイテンシ、インタラクティブなトランザクションが必要なら WebSocket ドライバ（`Pool`）を使う
- **Hyperdrive は Free / Paid 両方の Workers プランに含まれる。Free は 1 日 10 万クエリ**（UTC 00:00 リセット）— https://developers.cloudflare.com/hyperdrive/platform/pricing/
- OpenNext 側の注意: **グローバルな DB クライアントを作ってはいけない。Workers はリクエストをまたいだコネクション再利用を許さない。** リクエストごとに生成し `maxUses: 1` を指定する — https://opennext.js.org/cloudflare/howtos/db

```ts
// OpenNext 公式の推奨形
export const getDb = cache(() => {
  const { env } = getCloudflareContext();
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, maxUses: 1 });
  return drizzle({ client: pool, schema });
});
```

### 6. Workers Free プランの枠

https://developers.cloudflare.com/workers/platform/limits/

| 項目 | Free | Paid |
|---|---|---|
| リクエスト | 100,000 / 日 | 無制限 |
| **CPU 時間** | **10 ms / 呼び出し** | 5 分 |
| メモリ | 128 MB | 128 MB |
| サブリクエスト | 50 / リクエスト | 10,000 / リクエスト |
| 同時待機コネクション | 6 | 6 |
| Worker 数 | 100 | 500 |

Paid は **$5/月から**（アカウント最低課金）— https://developers.cloudflare.com/workers/platform/pricing/

**最大のリスクは Free プランの CPU 10 ms。** Next.js の SSR は 1 リクエストで 10 ms の CPU を超えうる。また Prisma 公式ドキュメントは「Cloudflare の Free プランは Worker サイズ 3 MB 上限」と明記しており、Next.js サーバーバンドルはこれに触れる可能性がある。

### 7. Vercel との比較

https://vercel.com/docs/plans/hobby

| | Cloudflare Workers Free | Vercel Hobby |
|---|---|---|
| 商用利用 | 可 | **不可**（"the Hobby plan restricts users to non-commercial, personal use only"） |
| リクエスト | 10 万/日 | Edge Requests 100 万/月 |
| 関数 | CPU 10 ms/呼び出し | Active CPU 4 CPU-hrs、Invocations 100 万 |
| Next.js 対応 | アダプタ経由（本 ADR の主題） | ネイティブ・ゼロ設定 |
| 有料の入口 | $5/月 | Pro $20/ユーザー/月 |

**Vercel は手間では圧勝だが、Hobby プランが非商用限定である点が決定的。** 本プロジェクトは無料ユーザーに広告を出す前提（`CLAUDE.md` §15）なので Hobby は規約上使えず、Pro $20/月が実質の最低コストになる。Cloudflare なら $0〜$5/月。要件の「低い初期運用コスト」を満たすのは Cloudflare。

---

## 決定

**Cloudflare Workers 上に `@opennextjs/cloudflare`（1.20.x）で Next.js 16 をデプロイする。**

- Next.js: **16.3.5**（npm `latest`、2026-09-11）/ React 19.3.0
- アダプタ: `@opennextjs/cloudflare@^1.20.6`
- `wrangler.jsonc`: `compatibility_flags: ["nodejs_compat"]`、`compatibility_date` は 2024-09-23 以降（新規なので直近の日付を入れる）、`assets.directory = ".open-next/assets"` / `binding = "ASSETS"`
- 認証: Auth.js v5（`next-auth@5.0.0-beta.32`）。設定を `auth.config.ts`（edge-safe）と `auth.ts`（DB アダプタ込み）に分割し、`AUTH_TRUST_HOST=true` を設定。**Middleware では JWT セッションのみ扱い、DB アクセスを行わない**
- DB 接続: Phase 1 は `@neondatabase/serverless` の HTTP ドライバから始め、レイテンシ／接続数が問題になった時点で **Hyperdrive + `pg`** へ切り替える（Hyperdrive は Free プランでも 10 万クエリ/日まで使える）。どちらの場合も **DB クライアントをモジュールスコープに置かない**
- **vinext は今回は採用しない。** Next.js 16 の安定版が出るか、vinext の互換ダッシュボードが本プロジェクトの使用機能を全てカバーした時点で再評価する（Stage 8 のタイミングを想定）

---

## 理由

1. **beta を 2 つ重ねない。** Auth.js v5 が既に beta である以上、デプロイ基盤まで beta（vinext 1.0.0-beta.9）にすると、障害が起きたときに原因の切り分けができない。OpenNext は 1.20.6 の安定版で、Cloudflare 公式ドキュメントにも手順が維持されている。
2. **必要な機能が全部そろっている。** OpenNext の非対応は Node.js Middleware ただ一つで、本プロジェクトはそれを使わない（Auth.js の Middleware は edge-safe な JWT 検証で足りる）。一方 vinext は Cache Components やビルド時最適化に穴があり、カバレッジは 94%。
3. **Pages は選択肢ではない。** `next-on-pages` は archived で Next.js 14 止まり。Pages に残せるのは静的エクスポートのみだが、Auth.js の Route Handler と Neon 同期 API が必要なのでサーバーサイドは避けられない。
4. **Vercel は規約で落ちる。** 広告表示は商用利用にあたり、Hobby プランは非商用限定。Pro $20/月は Phase 1 の「低い初期運用コスト」に反する。
5. **ローカルファースト設計が Workers の制約と噛み合う。** エディタはクライアント側で完結し、サーバーは認証と同期 JSON API だけを担う。この形なら SSR 負荷が小さく、Free プランの CPU 10 ms 制約に収まる見込みが高い。

---

## 影響（実装側がやらなければならないこと）

### Stage 1（Foundation）で必ず検証すること

- [ ] **Free プランの CPU 10 ms 制約の実測（未実施。Neon の接続情報が必要なため Stage 6 で実施）。** Hello World ではなく、Auth.js のセッション検証 + Neon への 1 クエリを含む Route Handler で計測する。超えるなら Workers Paid（$5/月）に移るか、該当処理をクライアント側へ寄せる
- [x] **Worker バンドルサイズの実測（2026-09-13 実施）。** Free プランの上限は圧縮後 3 MB。
      `npm run cf:build` → `npx wrangler deploy --dry-run` の結果:
      **Total Upload 7806.47 KiB / gzip 1641.69 KiB（= 1.60 MB、上限の約 53%）**。
      この時点で Next.js 16.3.5 + React 19 + Auth.js v5 + `@neondatabase/serverless` + zod を含む。
      ORM を入れていない（ADR-002 で素の SQL を採用）ぶん余裕がある。
      **残り約 1.4 MB。大きめの依存を足すときは再測すること。**
- [ ] Auth.js v5 beta が OpenNext 1.20.x 上で Google OAuth を完走するかを、スタブ実装で先に通す（Stage 5 まで先送りしない。ここが崩れると基盤ごと作り直しになる）

### 実装ルール

- `middleware.ts` で `cookies()` / DB アクセス / Node API を使わない。Middleware は `auth.config.ts` の edge-safe 設定のみを import する
- DB クライアントをモジュールトップレベルで生成しない。`cache()` でリクエストスコープに包み、`pg` を使う場合は `maxUses: 1` を付ける
- サブリクエスト上限が Free で 50/リクエスト。1 回の同期 API で外部 fetch を 50 回以上行う設計にしない（バッチ同期なら問題にならない）
- エディタ画面は静的プリレンダリング + クライアントレンダリングに寄せ、Worker の CPU を消費させない
- `.dev.vars` / Cloudflare Secrets で機密を管理し、`DATABASE_URL` や `AUTH_SECRET` をクライアントバンドルに乗せない

### 運用

- デプロイは `npx @opennextjs/cloudflare build` → `wrangler deploy`。ローカル検証は `wrangler dev` で Workers ランタイムを使う（`next dev` だけで済ませると本番で初めて壊れる）
- Cloudflare の Next.js まわりは 2 年で 3 回変わっている。**Stage 8 で vinext の互換状況を再確認し、この ADR を更新する**

---

## 却下した選択肢

### vinext（`vinext@1.0.0-beta.9` + `@vinext/cloudflare`）

Cloudflare 自身が新規アプリの第一推奨としているが、**安定版が未リリース**（dist-tag `latest` が beta を指す）。Next.js 16 API サーフェスのカバレッジは 94% で、`"use cache"` / Cache Components、ビルド時の画像・フォント最適化が未対応。ビルドは Next.js + Turbopack より約 4.4 倍速くクライアントバンドルも小さいという利点はあるが、Phase 1 では速度より予測可能性を取る。Next.js の再実装である以上、非互換を踏んだときの情報が世の中にまだ少ない。Stage 8 で再評価する。

### Cloudflare Pages + `@cloudflare/next-on-pages`

deprecated / archived。Next.js 13–14 までしか対応しない。Edge ランタイム限定のため Auth.js の DB アダプタや `pg` が使えない。Cloudflare 公式も Workers への移行を案内している。

### Cloudflare Pages に静的エクスポート（`output: 'export'`）+ 別の API

エディタとローカル永続化だけなら成立するが、Auth.js のコールバック Route Handler と Neon 同期 API を別サービス（Workers / Hono）に分離する必要があり、結局 Workers を使うことになる。構成が 2 つに割れる分だけ複雑になる。

### Vercel（Hobby / Pro）

技術的にはゼロ設定で最も楽で、Next.js の新機能に即日追随できる。しかし **Hobby プランは非商用限定**であり、広告掲載を予定する本プロジェクトでは規約違反になる。Pro は $20/ユーザー/月で、Cloudflare の $0〜$5 に対して初期コストが重い。Phase 1 のコスト要件を満たさないため却下。ただし Cloudflare 側の CPU / バンドルサイズ検証が失敗した場合の退避先として記録しておく。

---

## 参照 URL

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/
- https://developers.cloudflare.com/pages/framework-guides/nextjs/
- https://opennext.js.org/cloudflare
- https://opennext.js.org/cloudflare/howtos/db
- https://github.com/cloudflare/vinext
- https://vinext.dev/
- https://github.com/cloudflare/next-on-pages
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/hyperdrive/platform/pricing/
- https://neon.com/docs/guides/cloudflare-workers
- https://authjs.dev/getting-started/deployment
- https://authjs.dev/getting-started/migrating-to-v5
- https://vercel.com/docs/plans/hobby
- npm registry dist-tags（2026-09-13 時点で直接取得）: `next@16.3.5` / `react@19.3.0` / `@opennextjs/cloudflare@1.20.6` / `vinext@1.0.0-beta.9` / `next-auth@4.24.15`・`beta 5.0.0-beta.32` / `@neondatabase/serverless@1.1.0`
