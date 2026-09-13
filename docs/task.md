# Web MindMap Phase 1 タスク一覧

## Phase 1 ゴール

- マインドマップを作成できる
- キーボードだけで快適に操作できる
- 自動保存される
- ローカル・クラウド同期ができる
- PCで安定して利用できる
- 無料ユーザーとして利用開始できる

---

# 0. 作業体制（複数 Claude セッションでの並行開発）

このプロジェクトは複数の Claude Code セッションが**同時に**進めます。
衝突を避けるため、**担当（オーナー）とファイル所有権**を以下で固定します。

## 0.1 リポジトリの場所（2026-09-13 変更）

- ローカル: `~/dev/mindmap`
- リモート: https://github.com/kawaguchi2236/mindmap （**public**。秘密情報は絶対にコミットしない）
- Google Drive 配下の旧フォルダは `MOVED.md` のみを残した案内用。**そこで作業しない。**

理由: `node_modules` / `.next` を Google Drive に同期させると極端に遅く、ファイルロックでビルドが失敗するため。

## 0.2 担当分割

| 担当 | セッション | 範囲（章番号） |
|---|---|---|
| **A** | 基盤・エディタ担当（初回セッション） | 1 プロジェクト準備 / 2 デザインシステム / 3 レイアウト / 6 キャンバス / 7 ノード / 8 接続線 / 9 ドラッグ操作 / 10 キーボード操作 / 11 ローカル保存(IndexedDB) |
| **B** | 認証・クラウド担当（別 Claude） | 4 認証 / 5 マップ一覧 / 12 クラウド同期 / 13 PNGエクスポート / 14 広告 / 15 設定 |
| 共通 | 着手者が都度宣言 | 16 パフォーマンス / 17 テスト / 18 リリース |

## 0.3 ファイル所有権（他担当のファイルを編集しない）

**A が所有（B は読むだけ）**

```
src/features/editor/**
src/features/persistence/**
src/lib/db/**
src/lib/model/**
src/components/ui/**
src/app/layout.tsx
src/app/globals.css
tests/editor/**  tests/persistence/**
```

**B が所有（A は読むだけ）**

```
src/features/auth/**
src/features/maps/**
src/features/sync/**
src/features/export/**
src/features/ads/**
src/app/(auth)/**  src/app/(app)/maps/**  src/app/settings/**
src/app/api/**
src/lib/server/**
tests/auth/**  tests/sync/**
```

**共有ファイル（全体上書き禁止・ピンポイント編集のみ・整形や並べ替えをしない）**

```
package.json          … 依存追加は該当行のみ追記
docs/task.md          … 自分の担当行のチェックのみ更新
next.config.ts / tsconfig.json / eslint.config.mjs
src/app/page.tsx
```

## 0.4 B が着手する前提（A が先に用意するもの）

B は以下が `main` に入ってから着手する。A は最優先でこれを出す。

- [x] Next.js 16 + React 19 + TypeScript プロジェクトの雛形
- [x] 共有データ型 `src/lib/model/types.ts`（User / MindMap / MindMapNode / SyncMeta）
- [x] IndexedDB リポジトリ `src/lib/db/`（契約 `types.ts` ＋ 実装 `indexeddb.ts`、入口は `getRepository()`）**実装完了・テスト25件合格**
- [x] ADR-001（Cloudflare ランタイム）/ ADR-002（クエリ層）/ ADR-005（同期競合）の決定メモ `docs/adr/`

## 0.5 運用ルール

- 作業前に必ず `git pull --rebase`。
- 1 タスク完了ごとに小さくコミットして push（長時間ローカルに溜めない）。
- 他担当の所有ファイルを変更したくなったら、**自分で直さず** task.md の「連絡事項」に書く。
- `docs/task.md` は全体を書き換えず、自分の担当行の `- [ ]` → `- [x]` だけを変更する。

## 0.6 連絡事項（担当間の申し送り）

- （未決・要ユーザー判断）**ルートノードのテキストをマップタイトルの既定値にするか。** 現状はルートに書いてもタイトルは「無題のマップ」のまま。一覧で改名はできるので機能欠落ではないが、担当Bから「ユーザーが戸惑う」との指摘。要件定義に無い挙動なので勝手に足さず保留（CLAUDE.md §1）。

- （A→B）**実機検証は IndexedDB を共有する。** ファイル所有権を分けてもブラウザの永続ストレージは分割されない。B はシークレットウィンドウ、テストデータのタイトルは `B検証-` 接頭辞。A は `/?map=<id>` を直打ちする。
- （A→B）`AppHeader` の `actions` は差し込み口なので、設定画面への導線は B のページ側から渡せる。`AppHeader` 自体の変更依頼は不要。

- （A→B）`@opennextjs/cloudflare` を採用。ADR-001 参照。認証・API ルートは Node.js ランタイム前提で書いてよい。
- （A→B）マップ一覧は `src/lib/db` の公開 API 経由で読むこと。IndexedDB を直接開かない。
- （A→B）GitHub リポジトリは **public**。Neon / Auth.js の秘密情報は `.env.local`（gitignore 済み）のみに置く。

### B の実装状況（2026-09-13）

- （B→全体）**§4 認証・§12 クラウド同期はコード実装が完了。ただし実インフラ未接続のため疎通は未検証。**
  必要な発行作業: ① Neon プロジェクト作成 → `DATABASE_URL` ② `001_init.sql` の適用 ③ Google OAuth クライアント発行 ④ Resend APIキーと送信ドメイン検証。すべて `.env.local` に置く。
- （B→A）**`version` の意味を合わせたい。** サーバは PUT 成功時に `version` の確定値を返し、ローカルはそれを**そのまま採用**する（自前で +1 し直さない）。`src/lib/model/types.ts` の「ローカル編集で +1」と併存して構わないが、push 成功後はサーバの値で上書きすること。
- （B→A）**`src/lib/db` の `MapRepository` に以下が足りない。**同期が壊れるので 3 番は必須。
  1. 論理削除済みも含む全件読み出し（`listMaps({ includeDeleted: true })` 相当）。同期は墓標と `userId` を見る必要がある。
  2. `getMap(id)` の `includeDeleted` オプション。現仕様は削除済みで `null` を返すため墓標を読めない。
  3. **サーバ由来の書き込み口** `saveMapFromServer(doc, version)` 相当。pull ではサーバが確定した `version` をそのまま入れたい。実装側で +1 されると `syncedVersion` と永久にずれる。
  4. push に成功したマップ**個別**に `userId` を立てる口（`claimGuestMaps` は一括のため）。
- （B→A）**`eslint.config.mjs` が `TypeError: Converting circular structure to JSON` で起動しない。** 共有ファイルのため B 側では触っていない。
- （B→A）`src/features/auth/config.ts` と `src/lib/server/db.ts` は**サーバ専用**。`server-only` パッケージ未導入のため import ガードが無い。クライアントコンポーネントから import しないこと。
- （B→A）認証ガードに `middleware.ts` は使わない（ADR-001: OpenNext が Node.js Middleware 非対応）。Route Handler 内の `getCurrentUser()` で判定する。
- （A→B）**A と B は同じ作業ツリー `~/dev/mindmap` を共有している。`git add -A` / `git commit -am` を使わないこと。** 相手の書きかけファイルを巻き込んでコミットしてしまう。必ず自分の所有パスを列挙して `git add` する。
- （A→B）`saveMap` の中では `syncState` を触らない方針にした。ローカル保存がクラウドの都合で遅くなる経路を作らないため（CLAUDE.md §5）。保存後に `pending` へ倒すのは同期側でお願いします。
- （B→A）ADR-002 は B が `docs/adr/ADR-002-query-layer.md` で決定（ORM 不使用・素の SQL）。**A の `ADR-002-appendix-orm-evaluation.md` は参考・不採用**。ADR-005（同期競合）も B が決定済み。
- （A→B）ADR-001 は `docs/adr/ADR-001-cloudflare-nextjs.md`。要点: `@opennextjs/cloudflare` 採用 / `middleware.ts` で `cookies()`・DB を使わない / DB クライアントをモジュールスコープに置かない / `nodejs_compat` と `compatibility_date >= 2024-09-23`。

---

# タスク

## 1. プロジェクト準備 — 担当 A
- [x] Next.jsプロジェクト作成
- [x] TypeScript設定
- [x] ESLint設定
- [x] Prettier設定
- [x] GitHubリポジトリ作成
- [x] Cloudflare 設定（`@opennextjs/cloudflare` + `wrangler.jsonc` + `open-next.config.ts`。`npm run cf:build` 成功、**バンドル gzip 1.60 MB / Free 上限 3 MB**）
- [ ] Neon PostgreSQL作成 → **担当 B**
- [x] Auth.js設定 → **担当 B**（コード実装完了。実際のログイン疎通は未検証）

## 2. デザインシステム — 担当 A
- [ ] カラーパレット
- [ ] フォント
- [ ] ボタン
- [ ] モーダル
- [ ] Input
- [ ] Tooltip
- [ ] アイコン

## 3. レイアウト — 担当 A
- [ ] Header
- [ ] Sidebar
- [ ] Main Layout
- [ ] ダークモード
- [ ] レスポンシブ対応

## 4. 認証 — 担当 B
- [x] Googleログイン
- [x] メールログイン
- [x] ログアウト
- [x] 未ログイン利用
- [ ] 初回起動処理

## 5. マップ一覧 — 担当 B（A の `src/lib/db` 完成後）
- [x] マップ一覧取得
- [x] 新規作成
- [x] 名前変更
- [x] 削除（論理削除＋取り消し導線）
- [x] 更新日時表示
- [x] 検索

## 6. キャンバス — 担当 A
- [x] Infinite Canvas
- [x] Zoom
- [x] Pan
- [x] 中央へ戻る

## 7. ノード — 担当 A
- [x] Root作成
- [x] 子ノード追加
- [x] 同階層追加
- [x] 編集
- [x] 削除
- [x] コピー
- [x] ペースト

## 8. 接続線 — 担当 A
- [x] 親子接続
- [x] 接続線描画
- [x] 自動更新

## 9. ドラッグ操作 — 担当 A
- [x] ノード移動（座標移動）
- [x] ドラッグ中表示
- [x] Drop処理
- [ ] ドラッグでの親付け替え（`tree.reparent()` は実装済み。UI 未接続）

## 10. キーボード操作 — 担当 A
- [x] Enter
- [x] Tab
- [x] Shift + Tab
- [x] Delete
- [x] Esc
- [x] Ctrl/Cmd + Z
- [x] Ctrl/Cmd + Shift + Z
- [x] Ctrl/Cmd + C
- [x] Ctrl/Cmd + V
- [x] 矢印キー移動

## 11. ローカル保存（IndexedDB） — 担当 A
- [x] 保存
- [x] 読み込み
- [x] 自動保存（500ms デバウンス / beforeunload・visibilitychange で flush）
- [x] バックアップ（JSON 書き出し・取り込み。取り込みは既存 ID を上書きしない）
- [x] オフライン編集（`useOnlineStatus`。保存失敗でも編集を止めない）**実機で検証済み**

## 12. クラウド同期（Neon） — 担当 B
- [ ] テーブル作成（SQL は `src/lib/server/migrations/001_init.sql` に用意済み。Neon への適用待ち）
- [x] 保存API
- [x] 読み込みAPI
- [x] 初回同期（ゲストマップの引き継ぎ）
- [x] 差分同期
- [x] 同期競合の判断表（CLAUDE.md §13）→ `docs/adr/ADR-005-sync-conflict.md`

## 13. PNGエクスポート — 担当 B（A のキャンバス完成後）
- [ ] PNG生成
- [ ] ダウンロード

## 14. 広告 — 担当 B
- [ ] マップ一覧
- [ ] テンプレート
- [ ] 設定画面
- [ ] Free / Pro判定

## 15. 設定 — 担当 B
- [x] ダークモード切替UI（トークンは A が用意）
- [x] アカウント
- [x] ログアウト（実際のサインアウト疎通は AUTH_SECRET 設定後に要確認）

## 16. パフォーマンス — 共通
- [x] 操作遅延100ms以内を目標（A、Chrome 実機・500ノード時）
      子ノード追加 104ms / 兄弟追加 114ms / Undo 79ms
      ※計測は requestAnimationFrame の刻み（≒16ms）を含む
- [x] 大量ノード検証（500ノード）（A、Chrome 実機）
      ノード501件・接続線500本を描画、`visibility: hidden` は0件。
      First Contentful Paint 156ms / load 完了 380ms
- [x] メモリ使用量確認（A）JS ヒープ 195MB（dev ビルド。本番ビルドでは要再測）
- [ ] スクロール最適化（現時点で必要な兆候なし。memo / 仮想化は入れない ← CLAUDE.md §10）

## 17. テスト — 共通（担当ごとに自分の範囲を書く）
- [x] Enterのみで作成（A、単体テスト）
- [x] Tabのみで階層作成（A、単体テスト）
- [x] Undo / Redo（A、単体テスト）
- [x] オートセーブ（A、単体テスト）
- [x] オフライン確認（A、Chrome 実機）: dev サーバーを実際に停止した状態で編集を継続し、
      IndexedDB に保存されること／サーバー復帰後のリロードでノード8件・接続線7本が
      復元されることを確認。合成の `offline` イベントでは `navigator.onLine` が
      変わらないため無効（担当Bの検証手法が成立しなかった理由）
- [x] 実機通し（A、Chrome）: ゲストで開く→Tab/Enter で階層→テキスト入力→Undo/Redo→リロードで復元→接続線描画→ダークモード切替
- [ ] クラウド同期確認（B）
- [ ] PNG出力確認（B）

## 18. リリース — 共通
- [ ] 本番デプロイ
- [ ] 独自ドメイン設定
- [ ] Analytics導入
- [ ] エラー監視導入

---

# 優先順位

## Must
- 環境構築
- 認証
- マップ一覧
- キャンバス
- ノード編集
- キーボード操作
- 保存
- クラウド同期

## Should
- PNGエクスポート
- ダークモード
- 検索
- 広告

## Could
- 操作チュートリアル
- アニメーション改善
- 詳細設定

---

# 推奨開発順序

1. 環境構築
2. マップ一覧
3. キャンバス
4. ノード編集
5. キーボード操作
6. IndexedDB保存
7. 認証
8. Neon同期
9. PNGエクスポート
10. 広告・設定
11. テスト
12. リリース
