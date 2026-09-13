import { describe, expect, it } from "vitest";
import {
  createLocalStore,
  toDocument,
  toRecord,
  toSyncMeta,
} from "@/features/sync/local-store-adapter";
import type { MapRepository } from "@/lib/db/types";
import type { ID, MindMapDocument, MindMapSummary, SyncMeta } from "@/lib/model/types";
import { SCHEMA_VERSION } from "@/lib/model/types";
import { makeRecord } from "./helpers";

/**
 * 担当 A の `MapRepository` と `LocalStore` ポートの繋ぎ込みを検証する。
 *
 * ここで使うのは実 IndexedDB ではなくインメモリのフェイクなので、
 * **この層が実機で動く保証にはならない**（型と呼び出し規約の検証まで）。
 * 実 IndexedDB での確認は担当 A の `tests/persistence` 側の責務。
 */

const T0 = "2026-09-13T00:00:00.000Z";
const NOW = "2026-09-13T18:00:00.000Z";

function makeDoc(overrides: Partial<MindMapDocument["map"]> = {}): MindMapDocument {
  const id = overrides.id ?? "m1";
  return {
    schemaVersion: SCHEMA_VERSION,
    map: {
      id,
      userId: null,
      title: "テストマップ",
      createdAt: T0,
      updatedAt: T0,
      deletedAt: null,
      version: 3,
      ...overrides,
    },
    nodes: [
      {
        id: "n1",
        mapId: id,
        parentId: null,
        text: "ルート",
        x: 0,
        y: 0,
        collapsed: false,
        order: 0,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
  };
}

/** 同期アダプタが使う口だけを持つインメモリ実装。他は呼ばれたら落とす。 */
class FakeRepository implements MapRepository {
  readonly docs = new Map<ID, MindMapDocument>();
  readonly metas = new Map<ID, SyncMeta>();
  readonly calls: string[] = [];
  /** getMap が null を返すマップ（一覧取得との競り合いの再現）。 */
  readonly vanished = new Set<ID>();

  constructor(docs: MindMapDocument[] = []) {
    for (const doc of docs) this.docs.set(doc.map.id, doc);
  }

  async listMaps(options?: { includeDeleted?: boolean }): Promise<MindMapSummary[]> {
    this.calls.push(`listMaps:includeDeleted=${options?.includeDeleted ?? false}`);
    return [...this.docs.values()]
      .filter((doc) => options?.includeDeleted || doc.map.deletedAt === null)
      .map((doc) => ({
        id: doc.map.id,
        title: doc.map.title,
        updatedAt: doc.map.updatedAt,
        createdAt: doc.map.createdAt,
        nodeCount: doc.nodes.length,
        syncState: this.metas.get(doc.map.id)?.state ?? "local-only",
        userId: doc.map.userId,
        deletedAt: doc.map.deletedAt,
      }));
  }

  async getMap(id: ID, options?: { includeDeleted?: boolean }): Promise<MindMapDocument | null> {
    this.calls.push(`getMap:${id}:includeDeleted=${options?.includeDeleted ?? false}`);
    if (this.vanished.has(id)) return null;
    const doc = this.docs.get(id);
    if (!doc) return null;
    if (doc.map.deletedAt !== null && !options?.includeDeleted) return null;
    return doc;
  }

  async saveMapFromServer(
    doc: MindMapDocument,
    options?: { expectedLocalVersion?: number | null },
  ): Promise<MindMapDocument> {
    this.calls.push(
      `saveMapFromServer:${doc.map.id}:expected=${String(options?.expectedLocalVersion)}`,
    );
    this.docs.set(doc.map.id, doc);
    return doc;
  }

  async setSyncMeta(meta: SyncMeta): Promise<void> {
    this.calls.push(`setSyncMeta:${meta.mapId}:${meta.state}`);
    this.metas.set(meta.mapId, meta);
  }

  async getSyncMeta(mapId: ID): Promise<SyncMeta | null> {
    return this.metas.get(mapId) ?? null;
  }

  async claimMap(mapId: ID, userId: ID): Promise<void> {
    this.calls.push(`claimMap:${mapId}:${userId}`);
    const doc = this.docs.get(mapId);
    if (!doc) throw new Error(`マップ ${mapId} が見つかりません。`);
    // version も updatedAt も動かさない。
    this.docs.set(mapId, { ...doc, map: { ...doc.map, userId } });
  }

  // 同期アダプタが使わない口。呼ばれたら設計違反なので落とす。
  searchMaps(): Promise<MindMapSummary[]> {
    throw new Error("同期アダプタは searchMaps を使わない");
  }
  saveMap(): Promise<MindMapDocument> {
    throw new Error("同期アダプタは saveMap ではなく saveMapFromServer を使う");
  }
  createMap(): Promise<MindMapDocument> {
    throw new Error("同期アダプタは createMap を使わない");
  }
  renameMap(): Promise<void> {
    throw new Error("同期アダプタは renameMap を使わない");
  }
  deleteMap(): Promise<void> {
    throw new Error("同期アダプタは deleteMap を使わない");
  }
  restoreMap(): Promise<void> {
    throw new Error("同期アダプタは restoreMap を使わない");
  }
  listGuestMaps(): Promise<MindMapSummary[]> {
    throw new Error("同期アダプタは listGuestMaps を使わない");
  }
  claimGuestMaps(): Promise<ID[]> {
    throw new Error("同期アダプタは一括の claimGuestMaps ではなく claimMap を使う");
  }
}

describe("listLocal", () => {
  it("墓標も含めた全件を読み、同期メタを合成して返す", async () => {
    const repo = new FakeRepository([
      makeDoc({ id: "m1", version: 4 }),
      makeDoc({ id: "m2", version: 2, deletedAt: NOW }),
    ]);
    repo.metas.set("m1", {
      mapId: "m1",
      state: "pending",
      lastSyncedAt: T0,
      lastSyncedVersion: 3,
      lastError: null,
    });
    const store = createLocalStore(repo, { now: () => NOW });

    const records = await store.listLocal();

    expect(records.map((r) => r.map.id).sort()).toEqual(["m1", "m2"]);
    const m1 = records.find((r) => r.map.id === "m1");
    expect(m1?.dirty).toBe(true); // state === "pending"
    expect(m1?.syncedVersion).toBe(3);
    expect(m1?.map.version).toBe(4);

    // 同期メタが無いマップは未同期扱い。
    const m2 = records.find((r) => r.map.id === "m2");
    expect(m2?.syncedVersion).toBe(0);
    expect(m2?.dirty).toBe(false);
    expect(m2?.map.deletedAt).toBe(NOW);

    // 墓標を取りこぼさないよう includeDeleted を立てている。
    expect(repo.calls).toContain("listMaps:includeDeleted=true");
    expect(repo.calls).toContain("getMap:m2:includeDeleted=true");
  });

  it("一覧取得と本体読み込みの間に消えた 1 件は飛ばす", async () => {
    const repo = new FakeRepository([makeDoc({ id: "m1" }), makeDoc({ id: "m2" })]);
    repo.vanished.add("m2");
    const store = createLocalStore(repo, { now: () => NOW });

    const records = await store.listLocal();

    expect(records.map((r) => r.map.id)).toEqual(["m1"]);
  });
});

describe("putLocal", () => {
  it("saveMapFromServer に expectedLocalVersion を渡し、同期メタも更新する", async () => {
    const repo = new FakeRepository([makeDoc({ id: "m1" })]);
    const store = createLocalStore(repo, { now: () => NOW });

    await store.putLocal(
      makeRecord({ syncedVersion: 7, dirty: false, map: { id: "m1", version: 7 } }),
      { expectedLocalVersion: 3 },
    );

    expect(repo.calls).toContain("saveMapFromServer:m1:expected=3");
    expect(repo.calls).toContain("setSyncMeta:m1:synced");
    expect(repo.metas.get("m1")).toEqual({
      mapId: "m1",
      state: "synced",
      lastSyncedAt: NOW,
      lastSyncedVersion: 7,
      lastError: null,
    });
    // version は進めない。サーバが決めた値がそのまま入る。
    expect(repo.docs.get("m1")?.map.version).toBe(7);
  });

  it("保存が拒否されたら同期メタを書き換えない", async () => {
    const repo = new FakeRepository([makeDoc({ id: "m1" })]);
    repo.saveMapFromServer = async () => {
      const error = new Error("拒否");
      error.name = "StaleWriteError";
      throw error;
    };
    const store = createLocalStore(repo, { now: () => NOW });

    await expect(store.putLocal(makeRecord({ map: { id: "m1" } }))).rejects.toThrow("拒否");
    expect(repo.metas.has("m1")).toBe(false);
  });
});

describe("claimLocal", () => {
  it("claimMap に委譲し、version も updatedAt も動かさない", async () => {
    const repo = new FakeRepository([makeDoc({ id: "g1", version: 5 })]);
    const store = createLocalStore(repo, { now: () => NOW });

    await store.claimLocal("g1", "u9");

    expect(repo.calls).toContain("claimMap:g1:u9");
    expect(repo.docs.get("g1")?.map.userId).toBe("u9");
    expect(repo.docs.get("g1")?.map.version).toBe(5);
    expect(repo.docs.get("g1")?.map.updatedAt).toBe(T0);
    // マップは消えていない。
    expect(repo.docs.size).toBe(1);
  });
});

describe("deleteLocalHard", () => {
  it("同期の責務ではないので呼ばれたら失敗する（黙って消さない）", async () => {
    const repo = new FakeRepository([makeDoc({ id: "m1" })]);
    const store = createLocalStore(repo, { now: () => NOW });

    await expect(store.deleteLocalHard("m1")).rejects.toThrow("物理削除は同期の責務ではありません");
    expect(repo.docs.has("m1")).toBe(true);
  });
});

describe("型の変換", () => {
  it("ドキュメント → レコード → ドキュメントで内容が保たれる", () => {
    const doc = makeDoc({ id: "m1", userId: "u1", version: 4 });
    const record = toRecord(doc, null);
    const back = toDocument(record);

    expect(back).toEqual(doc);
  });

  it("ノードの mapId は所属先のマップ ID で復元される（競合コピー対策）", () => {
    const doc = makeDoc({ id: "m1" });
    const record = toRecord(doc, null);
    // 競合コピーは新しいマップ ID を持つ。
    const copy = { ...record, map: { ...record.map, id: "copy-1" } };

    expect(toDocument(copy).nodes.every((n) => n.mapId === "copy-1")).toBe(true);
  });

  it("同期状態を SyncState へ写す", () => {
    const base = makeRecord({ map: { id: "m1" } });
    expect(toSyncMeta({ ...base, dirty: true, syncedVersion: 3 }, NOW).state).toBe("pending");
    expect(toSyncMeta({ ...base, dirty: false, syncedVersion: 3 }, NOW).state).toBe("synced");
    expect(toSyncMeta({ ...base, dirty: false, syncedVersion: 0 }, NOW).state).toBe("local-only");
    // 未同期なら「最後に同期した時刻」は残さない。
    expect(toSyncMeta({ ...base, dirty: false, syncedVersion: 0 }, NOW).lastSyncedAt).toBeNull();
  });
});
