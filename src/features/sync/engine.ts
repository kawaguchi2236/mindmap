import {
  decideGuestMigrationAction,
  decideSyncAction,
  type SyncAction,
  type SyncReason,
} from "./decide";
import type { MapSummary, SyncMap, SyncNode } from "./protocol";
import {
  isStaleWriteError,
  type LocalMapRecord,
  type LocalStore,
  type RemoteClient,
  type RemoteFailureKind,
  type RemoteResult,
} from "./types";

/**
 * 同期のオーケストレーション。
 *
 * 判定は `decide.ts`、通信は `RemoteClient`、保存は `LocalStore` に任せ、
 * ここは「判断表の結果を安全な順序で実行する」ことだけを担当する。
 *
 * 絶対に守る不変条件（ADR-005 §4 / CLAUDE.md §6, §29）:
 *   1. どのマップで失敗しても、ほかのマップの同期は続行する。
 *   2. 失敗してもローカルのデータは 1 バイトも失われない。
 *   3. 例外を外へ投げない。オフラインは「失敗の記録」であって障害ではない。
 */

// ---------------------------------------------------------------------------
// 結果とイベント
// ---------------------------------------------------------------------------

export interface SyncFailure {
  mapId: string;
  kind: RemoteFailureKind | "localStore";
  message: string;
}

/** 複製による競合解決が起きたときの記録。UI はこれを見てユーザーに知らせる。 */
export interface SyncConflict {
  /** 元のマップ ID。 */
  mapId: string;
  /**
   * 退避先の新しいマップ ID。
   * 通常は**ローカル版**の複製（元 ID にはサーバ版が入る）。
   * `reason === "local-store-stale-write"` のときだけ逆で、
   * 元 ID にローカル版が残り、この ID に**サーバ版**が入る。
   */
  copyId: string;
  reason: SyncReason;
}

export interface SyncSummary {
  /** サーバへ送れたマップ。 */
  pushed: string[];
  /** サーバから取り込んだマップ。 */
  pulled: string[];
  /** ローカルの削除をサーバへ伝えられたマップ。 */
  pushedDeletes: string[];
  /** サーバの削除をローカルへ適用したマップ。 */
  appliedDeletes: string[];
  /** ローカルの削除を取り消してサーバ版を復元したマップ。 */
  restored: string[];
  /** 何もしなかったマップ。 */
  skipped: string[];
  conflicts: SyncConflict[];
  failed: SyncFailure[];
  /** 一覧取得に失敗して突き合わせを始められなかった場合の理由。 */
  abortedReason?: string;
}

export type SyncEvent =
  | { type: "sync-started" }
  | { type: "map-decided"; mapId: string; action: SyncAction }
  | { type: "map-succeeded"; mapId: string; action: SyncAction }
  | { type: "map-conflicted"; conflict: SyncConflict }
  | { type: "map-failed"; failure: SyncFailure }
  | { type: "sync-finished"; summary: SyncSummary };

export interface SyncOptions {
  local: LocalStore;
  remote: RemoteClient;
  /** ログイン中のユーザー ID。ゲストとして同期する場合は null。 */
  userId?: string | null;
  onEvent?: (event: SyncEvent) => void;
  /** テスト用の差し替え口。 */
  now?: () => string;
  newId?: () => string;
  /** ローカル版を退避した競合コピーのタイトルに付ける接尾辞。 */
  conflictTitleSuffix?: string;
  /** サーバ版を退避した複製のタイトルに付ける接尾辞（ADR-005 #18）。 */
  serverCopyTitleSuffix?: string;
}

const DEFAULT_CONFLICT_SUFFIX = "（競合コピー）";
const DEFAULT_SERVER_COPY_SUFFIX = "（サーバ版コピー）";
/** SyncMap.title の上限（protocol.ts）。接尾辞を足しても超えないように切り詰める。 */
const MAX_TITLE_LENGTH = 200;

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * ローカルとサーバの全マップを突き合わせて同期する。
 *
 * 例外は投げない。すべての失敗は戻り値の `failed` / `abortedReason` に入る。
 */
export async function syncAll(options: SyncOptions): Promise<SyncSummary> {
  const ctx = createContext(options);
  const summary = emptySummary();
  emit(ctx, { type: "sync-started" });

  // 突き合わせには差分ではなく全件一覧を使う。差分だと更新のないマップを
  // 「サーバから消えた」と誤判定する（ADR-005 §2）。
  const listed = await safeRemote(() => ctx.remote.listSummaries());
  let locals: LocalMapRecord[];
  try {
    locals = await ctx.local.listLocal();
  } catch (error) {
    summary.abortedReason = `ローカルの一覧取得に失敗しました: ${describe(error)}`;
    emit(ctx, { type: "sync-finished", summary });
    return summary;
  }

  if (!listed.ok) {
    // サーバに届かない。ローカルは何も触らずに終える。
    summary.abortedReason =
      listed.kind === "conflict"
        ? "一覧取得で予期しない競合が返りました"
        : `サーバの一覧取得に失敗しました (${listed.kind})`;
    emit(ctx, { type: "sync-finished", summary });
    return summary;
  }

  const remoteById = new Map(listed.data.map((s) => [s.id, s]));
  const localById = new Map(locals.map((r) => [r.map.id, r]));
  const ids = [...new Set([...localById.keys(), ...remoteById.keys()])];

  for (const id of ids) {
    const record = localById.get(id);
    const remote = remoteById.get(id);
    const action = decideSyncAction(record, remote);
    emit(ctx, { type: "map-decided", mapId: id, action });
    await runAction(ctx, summary, id, action, record, remote);
  }

  emit(ctx, { type: "sync-finished", summary });
  return summary;
}

/**
 * 初回ログイン時に、ゲストのマップ（`userId === null`）をアカウントへ引き継ぐ。
 *
 * **ローカルのゲストマップは決して削除しない。** 送信に成功したものは
 * `userId` を書き込むだけ。失敗したものはゲストのまま残り、次回再試行される。
 */
export async function migrateGuestMaps(
  options: SyncOptions & { userId: string },
): Promise<SyncSummary> {
  const ctx = createContext(options);
  const summary = emptySummary();
  emit(ctx, { type: "sync-started" });

  let locals: LocalMapRecord[];
  try {
    locals = await ctx.local.listLocal();
  } catch (error) {
    summary.abortedReason = `ローカルの一覧取得に失敗しました: ${describe(error)}`;
    emit(ctx, { type: "sync-finished", summary });
    return summary;
  }

  for (const record of locals) {
    if (record.userId !== null) continue;
    const action = decideGuestMigrationAction(record);
    emit(ctx, { type: "map-decided", mapId: record.map.id, action });
    await runAction(ctx, summary, record.map.id, action, record, undefined);
  }

  emit(ctx, { type: "sync-finished", summary });
  return summary;
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

interface Context extends Required<Omit<SyncOptions, "onEvent" | "userId">> {
  onEvent?: (event: SyncEvent) => void;
  userId: string | null;
}

function createContext(options: SyncOptions): Context {
  return {
    local: options.local,
    remote: options.remote,
    userId: options.userId ?? null,
    onEvent: options.onEvent,
    now: options.now ?? (() => new Date().toISOString()),
    newId: options.newId ?? defaultNewId,
    conflictTitleSuffix: options.conflictTitleSuffix ?? DEFAULT_CONFLICT_SUFFIX,
    serverCopyTitleSuffix: options.serverCopyTitleSuffix ?? DEFAULT_SERVER_COPY_SUFFIX,
  };
}

/** 1 マップ分の実行。ここで必ず失敗を握りつぶし、次のマップへ進めるようにする。 */
async function runAction(
  ctx: Context,
  summary: SyncSummary,
  id: string,
  action: SyncAction,
  record: LocalMapRecord | undefined,
  remote: MapSummary | undefined,
): Promise<void> {
  try {
    await executeAction(ctx, summary, id, action, record, remote);
  } catch (error) {
    // LocalStore が投げた場合などの最後の砦。ここで止まらない。
    fail(ctx, summary, { mapId: id, kind: "localStore", message: describe(error) });
  }
}

async function executeAction(
  ctx: Context,
  summary: SyncSummary,
  id: string,
  action: SyncAction,
  record: LocalMapRecord | undefined,
  remote: MapSummary | undefined,
): Promise<void> {
  switch (action.type) {
    case "noop": {
      summary.skipped.push(id);
      emit(ctx, { type: "map-succeeded", mapId: id, action });
      return;
    }

    case "push": {
      if (!record) return;
      const res = await safeRemote(() => ctx.remote.putMap(record.map, action.baseVersion));
      if (res.ok) {
        await ctx.local.putLocal({
          map: res.data,
          userId: ctx.userId ?? record.userId,
          syncedVersion: res.data.version,
          dirty: false,
        });
        summary.pushed.push(id);
        emit(ctx, { type: "map-succeeded", mapId: id, action });
        return;
      }
      if (res.kind === "conflict") {
        // 競り合いが起きていた。安全側＝ローカル版を複製して両方残す。
        await forkLocalCopy(ctx, summary, record, action.reason, res.serverMap, undefined);
        return;
      }
      if (res.kind === "notFound" && action.baseVersion > 0) {
        // サーバ仕様: 行が無いのに baseVersion > 0 だと 404。
        // 物理削除された（あるいは同期メタがずれた）ので、新規として作り直す。
        // 再試行は baseVersion 0 の 1 回だけ。2 度目の 404 はここに入らず失敗になる。
        const revive: SyncAction = { type: "push", reason: "push-404-revive", baseVersion: 0 };
        emit(ctx, { type: "map-decided", mapId: id, action: revive });
        await executeAction(ctx, summary, id, revive, record, remote);
        return;
      }
      fail(ctx, summary, { mapId: id, kind: res.kind, message: res.message ?? res.kind });
      return;
    }

    case "pull":
    case "pullRestore": {
      const res = await safeRemote(() => ctx.remote.getMap(id));
      if (!res.ok) {
        fail(ctx, summary, { mapId: id, ...toFailure(res) });
        return;
      }
      const written = await putServerVersion(ctx, summary, id, {
        map: res.data,
        userId: ctx.userId ?? record?.userId ?? null,
        syncedVersion: res.data.version,
        dirty: false,
      });
      if (!written) return; // ローカルが新しかった。サーバ版は複製として退避済み。
      if (action.type === "pull") summary.pulled.push(id);
      else summary.restored.push(id);
      emit(ctx, { type: "map-succeeded", mapId: id, action });
      return;
    }

    case "pushDelete": {
      if (!record) return;
      const res = await safeRemote(() => ctx.remote.deleteMap(id, action.baseVersion));
      if (res.ok) {
        // 墓標にするだけ。ノードはローカルに残しておく（物理削除は別工程）。
        await ctx.local.putLocal({
          map: {
            ...record.map,
            deletedAt: res.data.deletedAt ?? ctx.now(),
            version: res.data.version,
            updatedAt: res.data.updatedAt,
          },
          userId: ctx.userId ?? record.userId,
          syncedVersion: res.data.version,
          dirty: false,
        });
        summary.pushedDeletes.push(id);
        emit(ctx, { type: "map-succeeded", mapId: id, action });
        return;
      }
      if (res.kind === "conflict") {
        // 削除しようとしたらサーバ側が進んでいた＝「削除 対 編集」。編集を残す。
        await executeAction(
          ctx,
          summary,
          id,
          { type: "pullRestore", reason: "local-deleted-remote-modified" },
          record,
          remote,
        );
        return;
      }
      fail(ctx, summary, { mapId: id, kind: res.kind, message: res.message ?? res.kind });
      return;
    }

    case "applyRemoteDelete": {
      if (!record || !remote) return;
      await ctx.local.putLocal({
        map: {
          ...record.map,
          deletedAt: remote.deletedAt,
          version: remote.version,
          updatedAt: remote.updatedAt,
        },
        userId: ctx.userId ?? record.userId,
        syncedVersion: remote.version,
        dirty: false,
      });
      summary.appliedDeletes.push(id);
      emit(ctx, { type: "map-succeeded", mapId: id, action });
      return;
    }

    case "forkLocalCopy": {
      if (!record) return;
      await forkLocalCopy(ctx, summary, record, action.reason, undefined, remote);
      return;
    }
  }
}

/**
 * ローカル版を新しい ID で複製して残し、元の ID にはサーバ版を入れる。
 *
 * 順序が安全性そのもの:
 *   1. 複製を**先に**保存する（ここで落ちてもローカル版は元 ID に残っている）
 *   2. サーバ版を手に入れる（手に入らなければ元 ID は触らない）
 *   3. 元 ID をサーバ版で上書きする
 *   4. 複製をサーバへ送る（失敗しても dirty のまま残り、次回再試行される）
 */
async function forkLocalCopy(
  ctx: Context,
  summary: SyncSummary,
  record: LocalMapRecord,
  reason: SyncReason,
  serverMap: SyncMap | undefined,
  remote: MapSummary | undefined,
): Promise<void> {
  const id = record.map.id;
  const copy = buildCopy(ctx, record, ctx.conflictTitleSuffix);

  // 1. 複製を先に保存する。
  await ctx.local.putLocal(copy);

  // 2. 元 ID に入れるサーバ版を用意する。
  let adopted: LocalMapRecord | undefined;
  if (serverMap) {
    // 409 の応答に最新版が入っていた。追加の通信は不要。
    adopted = {
      map: serverMap,
      userId: ctx.userId ?? record.userId,
      syncedVersion: serverMap.version,
      dirty: false,
    };
  } else if (remote && remote.deletedAt !== null) {
    // サーバ側は削除済み。墓標を立てるだけでよく、通信も不要。
    adopted = {
      map: {
        ...record.map,
        deletedAt: remote.deletedAt,
        version: remote.version,
        updatedAt: remote.updatedAt,
      },
      userId: ctx.userId ?? record.userId,
      syncedVersion: remote.version,
      dirty: false,
    };
  } else {
    const res = await safeRemote(() => ctx.remote.getMap(id));
    if (res.ok) {
      adopted = {
        map: res.data,
        userId: ctx.userId ?? record.userId,
        syncedVersion: res.data.version,
        dirty: false,
      };
    } else {
      // サーバ版が取れない。元 ID は**上書きしない**。
      // 複製が 1 件増えるのは許容するが、失われるのは許容しない。
      fail(ctx, summary, {
        mapId: id,
        kind: toFailure(res).kind,
        message: `競合コピー ${copy.map.id} を作成しましたが、サーバ版を取得できませんでした`,
      });
    }
  }

  // 3. 元 ID を上書きする。
  if (adopted) {
    await ctx.local.putLocal(adopted);
  }

  const conflict: SyncConflict = { mapId: id, copyId: copy.map.id, reason };
  summary.conflicts.push(conflict);
  emit(ctx, { type: "map-conflicted", conflict });

  // 4. 複製の送信は best effort。失敗してもローカルに dirty で残る。
  const pushed = await safeRemote(() => ctx.remote.putMap(copy.map, 0));
  if (pushed.ok) {
    await ctx.local.putLocal({
      map: pushed.data,
      userId: copy.userId,
      syncedVersion: pushed.data.version,
      dirty: false,
    });
    summary.pushed.push(copy.map.id);
  }
}

/**
 * サーバ由来の内容をローカルへ書き戻す。
 *
 * ローカルが先に進んでいると `LocalStore` が `StaleWriteError` で拒否する
 * （担当 A の `saveMap` の仕様）。それは異常ではなく競合なので、
 * **ローカルを優先し、サーバ版を別 ID の複製として保持する**（ADR-005 #18）。
 *
 * @returns 書き戻せたら true。拒否されて退避に回したら false。
 */
async function putServerVersion(
  ctx: Context,
  summary: SyncSummary,
  id: string,
  incoming: LocalMapRecord,
): Promise<boolean> {
  try {
    await ctx.local.putLocal(incoming);
    return true;
  } catch (error) {
    if (!isStaleWriteError(error)) throw error;
    await forkRemoteCopy(ctx, summary, id, incoming);
    return false;
  }
}

/**
 * `forkLocalCopy` の鏡像。ローカル版が新しくて書き戻しを拒否されたときに、
 * 元 ID はローカル版のまま残し、**サーバ版**を新 ID の複製として保持する。
 */
async function forkRemoteCopy(
  ctx: Context,
  summary: SyncSummary,
  id: string,
  serverRecord: LocalMapRecord,
): Promise<void> {
  const copy = buildCopy(ctx, serverRecord, ctx.serverCopyTitleSuffix);
  await ctx.local.putLocal(copy);

  const conflict: SyncConflict = {
    mapId: id,
    copyId: copy.map.id,
    reason: "local-store-stale-write",
  };
  summary.conflicts.push(conflict);
  emit(ctx, { type: "map-conflicted", conflict });
  fail(ctx, summary, {
    mapId: id,
    kind: "localStore",
    message: `ローカル版の方が新しいため書き戻しを中止し、サーバ版を ${copy.map.id} として保持しました`,
  });

  // サーバ版の内容が次回の push で上書きされて消えないよう、別マップとして残す。
  const pushed = await safeRemote(() => ctx.remote.putMap(copy.map, 0));
  if (pushed.ok) {
    await ctx.local.putLocal({
      map: pushed.data,
      userId: copy.userId,
      syncedVersion: pushed.data.version,
      dirty: false,
    });
    summary.pushed.push(copy.map.id);
  }
}

/**
 * 競合コピーを組み立てる。
 *
 * ノード ID も振り直して完全に独立したマップにする。ローカル DB が
 * ノード ID をどうキーにしていても衝突しないようにするため。
 */
function buildCopy(ctx: Context, record: LocalMapRecord, suffix: string): LocalMapRecord {
  const nodeIdMap = new Map<string, string>();
  for (const node of record.map.nodes) {
    nodeIdMap.set(node.id, ctx.newId());
  }
  const nodes: SyncNode[] = record.map.nodes.map((node) => ({
    ...node,
    id: nodeIdMap.get(node.id) as string,
    parentId: node.parentId === null ? null : (nodeIdMap.get(node.parentId) ?? null),
  }));

  const now = ctx.now();
  return {
    map: {
      ...record.map,
      id: ctx.newId(),
      title: withSuffix(record.map.title, suffix),
      // 未送信の新規マップとして扱う。version > syncedVersion(0) を満たす。
      version: 1,
      deletedAt: null,
      updatedAt: now,
      nodes,
    },
    userId: ctx.userId ?? record.userId,
    syncedVersion: 0,
    dirty: true,
  };
}

function withSuffix(title: string, suffix: string): string {
  const combined = `${title}${suffix}`;
  if (combined.length <= MAX_TITLE_LENGTH) return combined;
  return `${title.slice(0, MAX_TITLE_LENGTH - suffix.length)}${suffix}`;
}

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

function emptySummary(): SyncSummary {
  return {
    pushed: [],
    pulled: [],
    pushedDeletes: [],
    appliedDeletes: [],
    restored: [],
    skipped: [],
    conflicts: [],
    failed: [],
  };
}

/**
 * 失敗した `RemoteResult` を `SyncFailure` の材料に変換する。
 * ここに来る `conflict` は本来起こらない組み合わせなので serverError に寄せる。
 */
function toFailure(
  res: Extract<RemoteResult<unknown>, { ok: false }>,
): Pick<SyncFailure, "kind" | "message"> {
  if (res.kind === "conflict") {
    return { kind: "serverError", message: "予期しない競合応答を受け取りました" };
  }
  return { kind: res.kind, message: res.message ?? res.kind };
}

function fail(ctx: Context, summary: SyncSummary, failure: SyncFailure): void {
  summary.failed.push(failure);
  emit(ctx, { type: "map-failed", failure });
}

/** 購読側が投げても同期を止めない。 */
function emit(ctx: Context, event: SyncEvent): void {
  if (!ctx.onEvent) return;
  try {
    ctx.onEvent(event);
  } catch {
    // 通知の失敗は同期の失敗ではない。
  }
}

/**
 * `RemoteClient` の実装が約束を破って例外を投げても、結果型に戻す。
 * オフライン時に `fetch` が reject するのが典型例。
 */
async function safeRemote<T>(run: () => Promise<RemoteResult<T>>): Promise<RemoteResult<T>> {
  try {
    return await run();
  } catch (error) {
    return { ok: false, kind: "network", message: describe(error) };
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function defaultNewId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  // ID の一意性は衝突確率ではなく実装の存在に依存させたくないので、最低限の代替。
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
