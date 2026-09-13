/**
 * 計測イベントの定義（CLAUDE.md §31）。
 *
 * ここが「何を送ってよいか」の唯一の定義。§31 が挙げた9件だけを型で固定し、
 * 勝手に増やさない。増やすときは §31 を先に更新すること。
 *
 * **最重要の設計**: ペイロードの値に素の `string` を一切許していない。
 * 許すのは数値・真偽値・**この表に書かれたリテラルだけ**。
 * ノードの本文・マップのタイトル・メールアドレスといった「利用者が書いたもの」は
 * どれも自由な文字列なので、型の時点で `track()` に渡せない。
 * レビューや規律ではなく、コンパイラが落とす形にしてある。
 */

/** 同期が失敗した理由。自由記述にしないための固定の語彙。 */
export type SyncFailureReason = "offline" | "conflict" | "unauthorized" | "server" | "unknown";

/** ログイン方法。メールアドレスそのものは送らない（§30）。 */
export type LoginMethod = "google" | "email";

/** ペイロードを持たないイベント。 */
type Empty = Record<string, never>;

/**
 * イベント名 → ペイロードの対応表。
 *
 * 数えてよいのは「いくつ・どちらか」だけ。中身は数えない。
 */
export interface TelemetryEventMap {
  /** アプリが開かれた。 */
  app_started: Empty;
  /** マップが新規作成された。 */
  map_created: Empty;
  /** マップが開かれた。 */
  map_opened: { readonly nodeCount: number };
  /** マップが編集された。**打鍵ごとには出さない**（track.ts で間引く）。 */
  map_edited: Empty;
  /** ノードが1件作られた。 */
  node_created: Empty;
  /** PNG を書き出した。`scaled` は上限に当たって縮小したか。 */
  png_exported: { readonly nodeCount: number; readonly scaled: boolean };
  /** ログインが完了した。 */
  login_completed: { readonly method: LoginMethod };
  /** クラウド同期が成功した。 */
  sync_completed: { readonly mapCount: number };
  /** クラウド同期が失敗した。 */
  sync_failed: { readonly reason: SyncFailureReason };
}

export type TelemetryEventName = keyof TelemetryEventMap;

/**
 * `track()` の引数。ペイロードが空のイベントは第2引数を書かなくてよい。
 *
 * `Empty` 判定に条件型を使っているのは、`track("node_created", {})` の `{}` が
 * 呼び出し側に散らかるのを避けるため。これ以上の汎用化はしない（§37）。
 */
export type TrackArgs<K extends TelemetryEventName> = TelemetryEventMap[K] extends Empty
  ? [name: K]
  : [name: K, properties: TelemetryEventMap[K]];

/** 送信する1件の形。 */
export interface TelemetryEnvelope {
  readonly name: TelemetryEventName;
  readonly properties: Readonly<Record<string, number | boolean | string>>;
  /** 発生時刻（epoch ms）。送信が遅れても発生順が分かるように付ける。 */
  readonly at: number;
}
