import type { MapSummary } from "./protocol";
import { hasUnseenRemoteChanges, hasUnsentLocalChanges, type LocalMapRecord } from "./types";

/**
 * 同期の競合判定（純関数）。
 *
 * `docs/adr/ADR-005-sync-conflict.md` の判断表をそのままコードにしたもの。
 * 表の行番号・`reason` の値・`tests/sync/decide.test.ts` のテスト名は 1 対 1 に
 * 対応させてある。表を直すときはこの 3 つを揃えて直すこと。
 *
 * **副作用を持たせないこと。** ここが同期のいちばん重要なテスト対象。
 */

/** ADR-005 の表の行に対応する識別子。ログにも UI にもそのまま出せる。 */
export type SyncReason =
  // 3.1 片側にしか存在しない
  | "both-absent"
  | "local-only-new"
  | "local-only-deleted"
  | "local-only-vanished"
  | "remote-only-alive"
  | "remote-only-deleted"
  // 3.2 両側にあり、どちらも生存
  | "in-sync"
  | "local-newer"
  | "remote-newer"
  | "both-modified"
  // 3.3 削除がからむ
  | "local-deleted"
  | "local-deleted-remote-modified"
  | "remote-deleted"
  | "remote-deleted-local-modified"
  | "both-deleted"
  // 3.4 初回ログイン
  | "guest-first-login"
  // 3.5 実行中にしか分からない競合（decide の戻り値ではなく engine が使う）
  | "push-404-revive"
  | "local-store-stale-write";

export type SyncAction =
  /** 何もしない。 */
  | { type: "noop"; reason: SyncReason }
  /** ローカル版をサーバへ送る。 */
  | { type: "push"; reason: SyncReason; baseVersion: number }
  /** サーバ版をローカルへ取り込む。 */
  | { type: "pull"; reason: SyncReason }
  /** ローカルの論理削除をサーバへ伝える。 */
  | { type: "pushDelete"; reason: SyncReason; baseVersion: number }
  /** サーバの論理削除をローカルへ適用する（ノードは消さない）。 */
  | { type: "applyRemoteDelete"; reason: SyncReason }
  /** ローカルの削除を取り消し、サーバ版を採用する。 */
  | { type: "pullRestore"; reason: SyncReason }
  /**
   * 判断がつかないので両方残す。
   * ローカル版を新 ID で複製して保存し、元の ID にはサーバ版を入れる。
   */
  | { type: "forkLocalCopy"; reason: SyncReason; baseVersion: number };

/**
 * ローカルの記録とサーバの要約を突き合わせて、取るべき動作を決める。
 *
 * @param local  ローカルの記録。無ければ undefined。
 * @param remote サーバの要約。無ければ undefined。
 *               **`GET /api/maps`（since なし）の全件から引くこと。**
 *               差分一覧から引くと `local-only-vanished` を誤検出する。
 */
export function decideSyncAction(
  local: LocalMapRecord | undefined,
  remote: MapSummary | undefined,
): SyncAction {
  // --- 3.1 片側にしか存在しない -------------------------------------------
  if (!local && !remote) {
    return { type: "noop", reason: "both-absent" };
  }

  if (!local) {
    // remote は必ず存在する
    const summary = remote as MapSummary;
    return summary.deletedAt !== null
      ? { type: "noop", reason: "remote-only-deleted" }
      : { type: "pull", reason: "remote-only-alive" };
  }

  if (!remote) {
    if (local.map.deletedAt !== null) {
      // サーバに無いものを消す必要はない。ローカルの墓標だけ残す。
      return { type: "noop", reason: "local-only-deleted" };
    }
    // 一度同期したのにサーバから消えている＝物理削除・DB 障害。復活させる。
    // 「余計な 1 件」より「消えた 1 件」の方が害が大きい（CLAUDE.md §6）。
    // どちらの場合もサーバ側の現在版数は 0 なので baseVersion は 0。
    const reason: SyncReason = local.syncedVersion === 0 ? "local-only-new" : "local-only-vanished";
    return { type: "push", reason, baseVersion: 0 };
  }

  const localDeleted = local.map.deletedAt !== null;
  const remoteDeleted = remote.deletedAt !== null;
  const localChanged = hasUnsentLocalChanges(local);
  const remoteChanged = hasUnseenRemoteChanges(local, remote);

  // --- 3.3 削除がからむ ----------------------------------------------------
  if (localDeleted && remoteDeleted) {
    return { type: "noop", reason: "both-deleted" };
  }

  if (localDeleted) {
    // 「こちらで削除」対「あちらで編集」。編集の方を残す。
    // 削除はやり直せるが、失われた編集は戻らない。
    return remoteChanged
      ? { type: "pullRestore", reason: "local-deleted-remote-modified" }
      : { type: "pushDelete", reason: "local-deleted", baseVersion: local.syncedVersion };
  }

  if (remoteDeleted) {
    // 「あちらで削除」対「こちらで編集」。未送信の編集があるなら複製して残す。
    return localChanged
      ? {
          type: "forkLocalCopy",
          reason: "remote-deleted-local-modified",
          baseVersion: local.syncedVersion,
        }
      : { type: "applyRemoteDelete", reason: "remote-deleted" };
  }

  // --- 3.2 両側にあり、どちらも生存 ----------------------------------------
  if (localChanged && remoteChanged) {
    // どちらが正しいか機械には判断できない。両方残してユーザーに知らせる。
    return { type: "forkLocalCopy", reason: "both-modified", baseVersion: local.syncedVersion };
  }
  if (localChanged) {
    return { type: "push", reason: "local-newer", baseVersion: local.syncedVersion };
  }
  if (remoteChanged) {
    return { type: "pull", reason: "remote-newer" };
  }
  return { type: "noop", reason: "in-sync" };
}

/**
 * ゲストマップ（`userId === null`）をログイン後のアカウントへ送るときの判定。
 *
 * 判定内容は `local-only-new` と同じだが、初回ログイン移行であることを
 * ログと集計で区別できるよう `reason` を分けてある。
 * 削除済みのゲストマップは送らない。
 */
export function decideGuestMigrationAction(local: LocalMapRecord): SyncAction {
  if (local.map.deletedAt !== null) {
    return { type: "noop", reason: "local-only-deleted" };
  }
  return { type: "push", reason: "guest-first-login", baseVersion: 0 };
}
