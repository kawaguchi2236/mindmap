import type { MapSummary, SyncMap, SyncNode } from "@/features/sync/protocol";
import type { LocalMapRecord, LocalStore, RemoteClient, RemoteResult } from "@/features/sync/types";

/**
 * 同期テスト用のフェイク一式。
 * IndexedDB も fetch も使わない（DOM に依存しない）。
 */

const T0 = "2026-09-13T00:00:00.000Z";

export function makeNode(overrides: Partial<SyncNode> = {}): SyncNode {
  return {
    id: "n1",
    parentId: null,
    text: "ルート",
    x: 0,
    y: 0,
    collapsed: false,
    order: 0,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

export function makeMap(overrides: Partial<SyncMap> = {}): SyncMap {
  return {
    id: "m1",
    title: "テストマップ",
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    deletedAt: null,
    nodes: [makeNode()],
    ...overrides,
  };
}

/** `map` はネストした部分指定を受け付ける（テストで書きたいのは差分だけ）。 */
export type RecordOverrides = Partial<Omit<LocalMapRecord, "map">> & { map?: Partial<SyncMap> };

export function makeRecord(overrides: RecordOverrides = {}): LocalMapRecord {
  const { map, ...rest } = overrides;
  return {
    map: makeMap(map),
    userId: "u1",
    syncedVersion: 1,
    dirty: false,
    ...rest,
  };
}

export function toSummary(map: SyncMap): MapSummary {
  const { nodes, ...rest } = map;
  return { ...rest, nodeCount: nodes.length };
}

// ---------------------------------------------------------------------------
// インメモリ LocalStore
// ---------------------------------------------------------------------------

export class FakeLocalStore implements LocalStore {
  readonly records = new Map<string, LocalMapRecord>();
  /** putLocal が投げるべきマップ ID（ローカル保存の失敗を再現する）。 */
  failOnPut = new Set<string>();
  /** putLocal が StaleWriteError を投げるべきマップ ID（担当 A の saveMap の拒否）。 */
  staleOnPut = new Set<string>();
  putCount = 0;
  /** 物理削除が呼ばれた記録。同期エンジンは決して呼ばないはず。 */
  readonly hardDeleted: string[] = [];

  constructor(initial: LocalMapRecord[] = []) {
    for (const record of initial) this.records.set(record.map.id, clone(record));
  }

  async listLocal(): Promise<LocalMapRecord[]> {
    return [...this.records.values()].map(clone);
  }

  async getLocal(id: string): Promise<LocalMapRecord | undefined> {
    const found = this.records.get(id);
    return found ? clone(found) : undefined;
  }

  async putLocal(record: LocalMapRecord): Promise<void> {
    this.putCount += 1;
    if (this.failOnPut.has(record.map.id)) {
      throw new Error(`IndexedDB 書き込み失敗: ${record.map.id}`);
    }
    if (this.staleOnPut.has(record.map.id)) {
      const stored = this.records.get(record.map.id);
      throw new StaleWriteError(record.map.id, record.map.version, stored?.map.version ?? 0);
    }
    this.records.set(record.map.id, clone(record));
  }

  async deleteLocalHard(id: string): Promise<void> {
    this.hardDeleted.push(id);
    this.records.delete(id);
  }

  /** テスト用の同期的な参照。 */
  peek(id: string): LocalMapRecord | undefined {
    const found = this.records.get(id);
    return found ? clone(found) : undefined;
  }
}

// ---------------------------------------------------------------------------
// インメモリ RemoteClient
// ---------------------------------------------------------------------------

type Failure = Extract<RemoteResult<never>, { ok: false }>;

export class FakeRemoteClient implements RemoteClient {
  readonly maps = new Map<string, SyncMap>();
  /** true の間、すべての呼び出しが network 失敗になる（オフライン）。 */
  offline = false;
  /** マップ ID ごとに次の 1 回だけ返す失敗を仕込む。 */
  readonly nextFailure = new Map<string, Failure>();
  /** マップ ID ごとに毎回返す失敗を仕込む（再試行がループしないことの検証用）。 */
  readonly alwaysFail = new Map<string, Failure>();
  /** 例外を投げる実装の再現（RemoteClient の約束破り）。 */
  throwOn = new Set<string>();
  /**
   * 一覧取得のあと PUT の直前に行が物理削除される、というレースの再現。
   * 1 度だけ行を消して 404 を返す。
   */
  readonly vanishOnPut = new Set<string>();
  readonly calls: string[] = [];

  constructor(initial: SyncMap[] = []) {
    for (const map of initial) this.maps.set(map.id, clone(map));
  }

  private intercept(id: string): Failure | undefined {
    if (this.throwOn.has(id)) throw new Error(`通信例外: ${id}`);
    if (this.offline) return { ok: false, kind: "network", message: "offline" };
    const persistent = this.alwaysFail.get(id);
    if (persistent) return persistent;
    const staged = this.nextFailure.get(id);
    if (staged) {
      this.nextFailure.delete(id);
      return staged;
    }
    return undefined;
  }

  async listSummaries(): Promise<RemoteResult<MapSummary[]>> {
    this.calls.push("list");
    const failure = this.intercept("*");
    if (failure) return failure;
    return { ok: true, data: [...this.maps.values()].map((m) => toSummary(clone(m))) };
  }

  async getMap(id: string): Promise<RemoteResult<SyncMap>> {
    this.calls.push(`get:${id}`);
    const failure = this.intercept(id);
    if (failure) return failure;
    const found = this.maps.get(id);
    if (!found) return { ok: false, kind: "notFound" };
    return { ok: true, data: clone(found) };
  }

  async putMap(map: SyncMap, baseVersion: number): Promise<RemoteResult<SyncMap>> {
    this.calls.push(`put:${map.id}`);
    const failure = this.intercept(map.id);
    if (failure) return failure;
    if (this.vanishOnPut.has(map.id)) {
      this.vanishOnPut.delete(map.id);
      this.maps.delete(map.id);
      return { ok: false, kind: "notFound" };
    }
    const current = this.maps.get(map.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== baseVersion) {
      // 楽観ロック不一致。サーバの最新をそのまま返す。
      return { ok: false, kind: "conflict", serverMap: clone(current as SyncMap) };
    }
    const saved: SyncMap = { ...clone(map), version: currentVersion + 1 };
    this.maps.set(map.id, saved);
    return { ok: true, data: clone(saved) };
  }

  async deleteMap(id: string, baseVersion: number): Promise<RemoteResult<SyncMap>> {
    this.calls.push(`delete:${id}`);
    const failure = this.intercept(id);
    if (failure) return failure;
    const current = this.maps.get(id);
    if (!current) return { ok: false, kind: "notFound" };
    if (current.version !== baseVersion) {
      return { ok: false, kind: "conflict", serverMap: clone(current) };
    }
    const tombstone: SyncMap = {
      ...clone(current),
      version: current.version + 1,
      deletedAt: "2026-09-13T12:00:00.000Z",
    };
    this.maps.set(id, tombstone);
    return { ok: true, data: clone(tombstone) };
  }
}

/**
 * 担当 A の `src/lib/db/errors.ts` の `StaleWriteError` と同じ `name` を持つ偽物。
 * A のモジュールを import せずに、同期エンジンの判定（name での識別）を検証する。
 */
export class StaleWriteError extends Error {
  constructor(
    readonly mapId: string,
    readonly incomingVersion: number,
    readonly storedVersion: number,
  ) {
    super(`マップ ${mapId} の保存を拒否しました`);
    this.name = "StaleWriteError";
  }
}

/** 決定的な ID 生成。テストで競合コピーの ID を検証できるようにする。 */
export function sequentialIds(prefix = "new"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
