import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getRepository, resetRepositoryForTests } from "@/lib/db";
import { StaleWriteError } from "@/lib/db/errors";
import { createNode, now } from "@/lib/model/factory";
import type { MapRepository } from "@/lib/db/types";
import type { MindMapDocument } from "@/lib/model/types";

let repo: MapRepository;

beforeEach(async () => {
  await resetRepositoryForTests();
  // テストごとにまっさらな IndexedDB を使う。
  globalThis.indexedDB = new IDBFactory();
  repo = getRepository();
});

afterEach(() => {
  vi.useRealTimers();
});

function addChild(doc: MindMapDocument, text: string): MindMapDocument {
  const root = doc.nodes.find((node) => node.parentId === null);
  if (!root) throw new Error("ルートノードがありません");
  const child = createNode({
    mapId: doc.map.id,
    parentId: root.id,
    text,
    order: doc.nodes.length,
  });
  return { ...doc, nodes: [...doc.nodes, child] };
}

describe("createMap / saveMap / getMap", () => {
  it("作成したマップをそのまま読み戻せる", async () => {
    const created = await repo.createMap("設計メモ");
    const loaded = await repo.getMap(created.map.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.map.title).toBe("設計メモ");
    expect(loaded!.map.userId).toBeNull();
    expect(loaded!.nodes).toHaveLength(1);
    expect(loaded!.nodes[0].parentId).toBeNull();
  });

  it("保存した内容が一致し、version と updatedAt は実装側が進める", async () => {
    const created = await repo.createMap("テスト");
    const edited = addChild({ ...created, map: { ...created.map, title: "編集後" } }, "子ノード");

    const saved = await repo.saveMap(edited);
    expect(saved.map.version).toBe(created.map.version + 1);
    expect(saved.map.createdAt).toBe(created.map.createdAt);

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.map.title).toBe("編集後");
    expect(loaded!.map.version).toBe(saved.map.version);
    expect(loaded!.nodes.map((n) => n.text)).toEqual(["", "子ノード"]);
  });

  it("存在しないマップは null を返す", async () => {
    expect(await repo.getMap("missing")).toBeNull();
  });
});

describe("論理削除", () => {
  it("削除したマップは一覧に出ないが getMap の対象データは残っている", async () => {
    const created = await repo.createMap("消すマップ");
    await repo.deleteMap(created.map.id);

    expect(await repo.listMaps()).toHaveLength(0);
    expect(await repo.getMap(created.map.id)).toBeNull();

    // 物理削除していないので復元できる。
    await repo.restoreMap(created.map.id);
    const restored = await repo.getMap(created.map.id);
    expect(restored).not.toBeNull();
    expect(restored!.map.title).toBe("消すマップ");
    expect(restored!.nodes).toHaveLength(1);
  });
});

describe("StaleWriteError", () => {
  it("古い version で保存しようとすると拒否され、保存済みデータは無傷", async () => {
    const created = await repo.createMap("競合");
    const stale = addChild(created, "古い編集からの追記");

    const fresh = await repo.saveMap(addChild(created, "新しい編集"));
    expect(fresh.map.version).toBeGreaterThan(stale.map.version);

    await expect(repo.saveMap(stale)).rejects.toBeInstanceOf(StaleWriteError);

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.map.version).toBe(fresh.map.version);
    expect(loaded!.nodes.map((n) => n.text)).toEqual(["", "新しい編集"]);
  });

  it("同じ version での保存は通常の上書きとして通る", async () => {
    const created = await repo.createMap("通常保存");
    const saved = await repo.saveMap(addChild(created, "a"));
    await expect(repo.saveMap(addChild(saved, "b"))).resolves.toBeTruthy();
  });
});

describe("claimGuestMaps", () => {
  it("マップを1件も減らさず userId だけ書き換える", async () => {
    const a = await repo.createMap("ゲスト A");
    const b = await repo.createMap("ゲスト B");
    const deleted = await repo.createMap("削除済みゲスト");
    await repo.deleteMap(deleted.map.id);

    const before = await repo.listGuestMaps();
    expect(before.map((m) => m.id).sort()).toEqual([a.map.id, b.map.id].sort());

    const claimed = await repo.claimGuestMaps("user-1");
    // 論理削除済みのゲストマップも取りこぼさず引き継ぐ。
    expect(claimed.sort()).toEqual([a.map.id, b.map.id, deleted.map.id].sort());

    // 件数が減っていない。
    expect(await repo.listMaps()).toHaveLength(2);
    expect(await repo.listGuestMaps()).toHaveLength(0);

    const loadedA = await repo.getMap(a.map.id);
    expect(loadedA!.map.userId).toBe("user-1");
    expect(loadedA!.nodes).toHaveLength(1);

    await repo.restoreMap(deleted.map.id);
    expect((await repo.getMap(deleted.map.id))!.map.userId).toBe("user-1");
  });
});

describe("searchMaps", () => {
  it("タイトルの部分一致（大文字小文字を区別しない）で絞り込む", async () => {
    await repo.createMap("Product Roadmap");
    await repo.createMap("読書メモ");
    const removed = await repo.createMap("Product Archive");
    await repo.deleteMap(removed.map.id);

    expect((await repo.searchMaps("product")).map((m) => m.title)).toEqual(["Product Roadmap"]);
    expect((await repo.searchMaps("MAP")).map((m) => m.title)).toEqual(["Product Roadmap"]);
    expect((await repo.searchMaps("メモ")).map((m) => m.title)).toEqual(["読書メモ"]);
    expect(await repo.searchMaps("該当なし")).toHaveLength(0);
    // 空文字は一覧と同じ。
    expect(await repo.searchMaps("  ")).toHaveLength(2);
  });
});

describe("listMaps", () => {
  it("updatedAt の降順で、nodeCount と syncState を含めて返す", async () => {
    // 同一ミリ秒での作成を避けるため時刻を固定して進める。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T00:00:00.000Z"));
    const older = await repo.createMap("古い");
    vi.setSystemTime(new Date("2026-09-13T00:01:00.000Z"));
    const newer = await repo.createMap("新しい");
    vi.setSystemTime(new Date("2026-09-13T00:02:00.000Z"));
    await repo.saveMap(addChild(newer, "子"));
    vi.useRealTimers();

    await repo.setSyncMeta({
      mapId: older.map.id,
      state: "pending",
      lastSyncedAt: null,
      lastSyncedVersion: null,
      lastError: null,
    });

    const list = await repo.listMaps();
    expect(list[0].id).toBe(newer.map.id);
    expect(list[0].nodeCount).toBe(2);
    expect(list[0].syncState).toBe("local-only");
    expect(list[1].id).toBe(older.map.id);
    expect(list[1].syncState).toBe("pending");
  });
});

describe("renameMap / syncMeta", () => {
  it("renameMap はタイトルのみ更新し version を進める", async () => {
    const created = await repo.createMap("旧タイトル");
    await repo.renameMap(created.map.id, "新タイトル");

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.map.title).toBe("新タイトル");
    expect(loaded!.map.version).toBe(created.map.version + 1);
    expect(loaded!.nodes).toHaveLength(1);
  });

  it("syncMeta を保存・取得できる", async () => {
    const created = await repo.createMap("同期");
    expect(await repo.getSyncMeta(created.map.id)).toBeNull();

    const meta = {
      mapId: created.map.id,
      state: "failed" as const,
      lastSyncedAt: now(),
      lastSyncedVersion: 1,
      lastError: "ネットワークエラー",
    };
    await repo.setSyncMeta(meta);
    expect(await repo.getSyncMeta(created.map.id)).toEqual(meta);
  });
});
