# Web MindMap

考えを止めずに書き出せる、シンプルで速い Web マインドマップアプリ。

キーボード中心の高速操作（Enter で兄弟ノード・Tab で子ノード）、自動保存、オフライン編集、ログイン後のクラウド同期を柱にした **ローカルファースト**の設計。

> 現在は **Phase 1（MVP）の実装フェーズ**。開発はローカルの `~/dev/mindmap` で行います（Google Drive 配下では行いません）。担当分割は [docs/task.md](docs/task.md) の §0 を参照。

## ドキュメント

| ファイル | 内容 |
|---|---|
| [docs/要件定義.md](docs/要件定義.md) | 要件定義書 v1.0（機能要件・非機能要件・データ要件）— **最上位の正** |
| [docs/task.md](docs/task.md) | Phase 1 タスク一覧と推奨開発順序 |
| [docs/ワイヤーフレーム.md](docs/ワイヤーフレーム.md) | 画面ワイヤーフレーム v0.1 |
| [design/ハンドオフ.md](design/ハンドオフ.md) | UI デザインのハンドオフ資料（配色・タイポ・コンポーネント仕様） |
| [design/Web MindMap UI.dc.html](design/Web%20MindMap%20UI.dc.html) | UI デザインリファレンス（ブラウザで直接開ける） |
| [design/styles.css](design/styles.css) | デザイントークン（Broadsheet）+ コンポーネントクラス |
| [CLAUDE.md](CLAUDE.md) | Claude Code 向け開発ルール（データ安全・同期方針・テスト戦略） |

## Phase 1 のスコープ

**入る**：ゲスト利用 / Google・メール認証 / マップの作成・一覧・リネーム・削除・検索 / 無限キャンバス（パン・ズーム） / ノードの作成・編集・削除・ドラッグ・折りたたみ / キーボード操作 / Undo・Redo / コピー＆ペースト / IndexedDB 保存と自動保存 / オフライン編集 / Neon へのクラウド同期 / ゲストマップの引き継ぎ / PNG 書き出し / ダークモード / 編集画面**外**の広告

**入らない**：AI 機能全般 / リアルタイム共同編集 / チーム・権限 / PDF・SVG・Markdown 書き出し / ファイル添付 / 課金

詳細は [CLAUDE.md](CLAUDE.md) の §3 を参照。

## 想定スタック

Next.js + React + TypeScript / IndexedDB（ローカル）/ Neon PostgreSQL（クラウド）/ Auth.js / Cloudflare ホスティング

いずれも実装開始前に Cloudflare ランタイム互換性を検証する（CLAUDE.md §32 の ADR-001〜005）。

## キーボードショートカット

| 入力 | 動作 |
|---|---|
| `Enter` | 兄弟ノードを作成 |
| `Tab` | 子ノードを作成 |
| `Shift + Tab` | 階層を1つ上へ移動 |
| `Delete` / `Backspace` | 選択ノードを削除（テキスト編集中を除く） |
| `Esc` | テキスト編集を抜ける → 選択を解除 |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` | Undo / Redo |
| `Cmd/Ctrl + C` / `Cmd/Ctrl + V` | コピー / ペースト |
| 矢印キー | 方向に応じて最も近いノードへ移動 |
