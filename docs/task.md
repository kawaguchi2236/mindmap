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
- [x] IndexedDB リポジトリの**契約** `src/lib/db/types.ts`（`MapRepository`）— B はこの型に対して実装してよい。実体は A が実装中
- [ ] ADR-001（Cloudflare ランタイム）/ ADR-002（ORM）の決定メモ `docs/adr/`

## 0.5 運用ルール

- 作業前に必ず `git pull --rebase`。
- 1 タスク完了ごとに小さくコミットして push（長時間ローカルに溜めない）。
- 他担当の所有ファイルを変更したくなったら、**自分で直さず** task.md の「連絡事項」に書く。
- `docs/task.md` は全体を書き換えず、自分の担当行の `- [ ]` → `- [x]` だけを変更する。

## 0.6 連絡事項（担当間の申し送り）

- （A→B）`@opennextjs/cloudflare` を採用。ADR-001 参照。認証・API ルートは Node.js ランタイム前提で書いてよい。
- （A→B）マップ一覧は `src/lib/db` の公開 API 経由で読むこと。IndexedDB を直接開かない。
- （A→B）GitHub リポジトリは **public**。Neon / Auth.js の秘密情報は `.env.local`（gitignore 済み）のみに置く。

---

# タスク

## 1. プロジェクト準備 — 担当 A
- [x] Next.jsプロジェクト作成
- [x] TypeScript設定
- [x] ESLint設定
- [x] Prettier設定
- [x] GitHubリポジトリ作成
- [ ] Cloudflare 設定（ADR-001 の結論に従う）
- [ ] Neon PostgreSQL作成 → **担当 B**
- [ ] Auth.js設定 → **担当 B**

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
- [ ] Googleログイン
- [ ] メールログイン
- [ ] ログアウト
- [ ] 未ログイン利用
- [ ] 初回起動処理

## 5. マップ一覧 — 担当 B（A の `src/lib/db` 完成後）
- [ ] マップ一覧取得
- [ ] 新規作成
- [ ] 名前変更
- [ ] 削除
- [ ] 更新日時表示
- [ ] 検索

## 6. キャンバス — 担当 A
- [ ] Infinite Canvas
- [ ] Zoom
- [ ] Pan
- [ ] 中央へ戻る

## 7. ノード — 担当 A
- [ ] Root作成
- [ ] 子ノード追加
- [ ] 同階層追加
- [ ] 編集
- [ ] 削除
- [ ] コピー
- [ ] ペースト

## 8. 接続線 — 担当 A
- [ ] 親子接続
- [ ] 接続線描画
- [ ] 自動更新

## 9. ドラッグ操作 — 担当 A
- [ ] ノード移動
- [ ] ドラッグ中表示
- [ ] Drop処理

## 10. キーボード操作 — 担当 A
- [ ] Enter
- [ ] Tab
- [ ] Shift + Tab
- [ ] Delete
- [ ] Esc
- [ ] Ctrl/Cmd + Z
- [ ] Ctrl/Cmd + Shift + Z
- [ ] Ctrl/Cmd + C
- [ ] Ctrl/Cmd + V
- [ ] 矢印キー移動

## 11. ローカル保存（IndexedDB） — 担当 A
- [ ] 保存
- [ ] 読み込み
- [ ] 自動保存
- [ ] バックアップ
- [ ] オフライン編集

## 12. クラウド同期（Neon） — 担当 B
- [ ] テーブル作成
- [ ] 保存API
- [ ] 読み込みAPI
- [ ] 初回同期（ゲストマップの引き継ぎ）
- [ ] 差分同期
- [ ] 同期競合の判断表（CLAUDE.md §13）

## 13. PNGエクスポート — 担当 B（A のキャンバス完成後）
- [ ] PNG生成
- [ ] ダウンロード

## 14. 広告 — 担当 B
- [ ] マップ一覧
- [ ] テンプレート
- [ ] 設定画面
- [ ] Free / Pro判定

## 15. 設定 — 担当 B
- [ ] ダークモード切替UI（トークンは A が用意）
- [ ] アカウント
- [ ] ログアウト

## 16. パフォーマンス — 共通
- [ ] 操作遅延100ms以内を目標
- [ ] 大量ノード検証（500ノード）
- [ ] メモリ使用量確認
- [ ] スクロール最適化

## 17. テスト — 共通（担当ごとに自分の範囲を書く）
- [ ] Enterのみで作成（A）
- [ ] Tabのみで階層作成（A）
- [ ] Undo / Redo（A）
- [ ] オートセーブ（A）
- [ ] オフライン確認（A）
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
