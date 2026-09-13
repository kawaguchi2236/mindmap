import type { MapSummary, SyncMap } from "./protocol";

/**
 * 同期エンジンが外界とやり取りするためのポート定義。
 *
 * 同期エンジンは IndexedDB も fetch も直接触らない。ここで定義した
 * `LocalStore` / `RemoteClient` を注入してもらう（CLAUDE.md §38
 * 「キャンバス描画をクラウド永続化に直結させない」の精神）。
 * おかげで判定ロジックは Node 上で DOM なしにテストできる。
 *
 * 判断表の本体は `docs/adr/ADR-005-sync-conflict.md`。
 */

// ---------------------------------------------------------------------------
// ローカル側のレコード
// ---------------------------------------------------------------------------

/**
 * 同期エンジンから見たローカル 1 マップ。
 *
 * `src/lib/db` の `MindMapDocument` + `SyncMeta` を、同期に必要な分だけに
 * 絞った形。実際の変換は `src/features/sync/local-store-adapter.ts`（担当 A の
 * 実装が入り次第）で行う。
 */
export interface LocalMapRecord {
  /** ワイヤフォーマットと同じ形のマップ本体（ノード込み）。 */
  map: SyncMap;
  /** null はゲストのマップ。ログイン時の移行対象になる。 */
  userId: string | null;
  /**
   * 最後にサーバと一致した `map.version`。未同期なら 0。
   * そのまま次回 PUT の `baseVersion` として使う。
   */
  syncedVersion: number;
  /**
   * ローカルに未送信の変更がある印。
   * `map.version > syncedVersion` と OR で評価する（版数の進め忘れを安全側に倒すため）。
   */
  dirty: boolean;
}

/** ローカルに未送信の変更があるか。判定は必ずこの関数を通す。 */
export function hasUnsentLocalChanges(record: LocalMapRecord): boolean {
  return record.dirty || record.map.version > record.syncedVersion;
}

/** サーバ側に未取得の変更があるか。 */
export function hasUnseenRemoteChanges(record: LocalMapRecord, remote: MapSummary): boolean {
  return remote.version > record.syncedVersion;
}

// ---------------------------------------------------------------------------
// ローカル永続化ポート
// ---------------------------------------------------------------------------

/**
 * ローカル保存への最小の口。
 *
 * 意図的に狭くしてある。担当 A の `MapRepository` がどう実装されていても、
 * 薄いアダプタでこの 4 つを満たせるはず。
 */
export interface LocalStore {
  /** 論理削除済みも含めた全レコード。突き合わせに墓標が必要なため除外しない。 */
  listLocal(): Promise<LocalMapRecord[]>;
  getLocal(id: string): Promise<LocalMapRecord | undefined>;
  /**
   * 上書き保存（原子的であること）。
   *
   * `record.userId` の変更は**所有者の付け替え**として実装すること
   * （担当 A の `claimGuestMaps` 相当）。ゲストマップを削除して作り直す実装は
   * 禁止（CLAUDE.md §6）。同期エンジンは `deleteLocalHard` を一切呼ばない。
   *
   * ローカル側が先に進んでいる場合、実装は `StaleWriteError` で拒否してよい。
   * 同期エンジンはそれを異常ではなく競合として扱う（ADR-005 #18）。
   */
  putLocal(record: LocalMapRecord): Promise<void>;
  /**
   * 物理削除。同期エンジンは**通常これを呼ばない**（論理削除で止める）。
   * 同期完了後のクリーンアップ用に口だけ開けてある。
   */
  deleteLocalHard(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// リモートポート
// ---------------------------------------------------------------------------

/** 失敗の種類。UI の出し分けと再試行可否の判断に使う。 */
export type RemoteFailureKind =
  /** 未ログイン／セッション切れ。再ログインが必要。 */
  | "unauthorized"
  /** サーバに存在しない（他人のマップも 404 になる）。 */
  | "notFound"
  /** リクエストが仕様に合っていない。再試行しても直らない＝こちらのバグ。 */
  | "invalidRequest"
  /** サーバ側のエラー。時間をおいて再試行する価値がある。 */
  | "serverError"
  /** オフライン・タイムアウト・CORS など到達できなかった場合。 */
  | "network";

export type RemoteResult<T> =
  | { ok: true; data: T }
  /** 409。サーバの最新版を添えて返し、判断はクライアントに委ねる。 */
  | { ok: false; kind: "conflict"; serverMap: SyncMap }
  | { ok: false; kind: RemoteFailureKind; message?: string };

/**
 * ローカル保存が「新しいものを古いもので潰すな」と拒否したか。
 *
 * 担当 A の `src/lib/db/errors.ts` の `StaleWriteError` を、
 * import せずに名前で判定する。同期エンジンを A の実装に結合させないため
 * （テストも Node 上で完結する）。
 */
export function isStaleWriteError(error: unknown): boolean {
  return error instanceof Error && error.name === "StaleWriteError";
}

/** 一時的な障害か（＝次回の同期で再試行する価値があるか）。 */
export function isRetryable(kind: RemoteFailureKind | "conflict"): boolean {
  return kind === "network" || kind === "serverError";
}

/**
 * クラウド API への最小の口。
 *
 * **実装は決して例外を投げないこと。** オフラインは `{ ok: false, kind: "network" }`
 * として返す。同期の失敗でアプリが落ちてはいけない（CLAUDE.md §29）。
 */
export interface RemoteClient {
  /**
   * 自分のマップ要約一覧。
   *
   * 注意: 突き合わせ（`syncAll`）では `since` を**使わないこと**。
   * 差分一覧に載っていないマップを「サーバから消えた」と誤判定する（ADR-005 §2）。
   */
  listSummaries(since?: string): Promise<RemoteResult<MapSummary[]>>;
  getMap(id: string): Promise<RemoteResult<SyncMap>>;
  /** 作成 or 更新。`baseVersion` 不一致なら `conflict` が返る。 */
  putMap(map: SyncMap, baseVersion: number): Promise<RemoteResult<SyncMap>>;
  /** 論理削除。戻り値は削除済みになったマップ。 */
  deleteMap(id: string, baseVersion: number): Promise<RemoteResult<SyncMap>>;
}
