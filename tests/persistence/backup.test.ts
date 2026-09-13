import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getRepository, resetRepositoryForTests } from "@/lib/db";
import { exportAllMaps, importMaps } from "@/lib/db/backup";
import { InvalidDocumentError } from "@/lib/db/errors";
import type { MapRepository } from "@/lib/db/types";
import type { MindMapDocument } from "@/lib/model/types";

let repo: MapRepository;

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  repo = getRepository();
});

describe("exportAllMaps / importMaps", () => {
  it("書き出して別の DB に読み込むと往復する", async () => {
    const a = await repo.createMap("マップ A");
    const b = await repo.createMap("マップ B");
    const json = await exportAllMaps();

    // まっさらな DB に入れ直す。
    await resetRepositoryForTests();
    globalThis.indexedDB = new IDBFactory();
    repo = getRepository();
    expect(await repo.listMaps()).toHaveLength(0);

    expect(await importMaps(json)).toEqual({ imported: 2, skipped: 0 });

    const restoredA = await repo.getMap(a.map.id);
    expect(restoredA).toEqual(a);
    expect((await repo.getMap(b.map.id))!.map.title).toBe("マップ B");
  });

  it("論理削除済みのマップも書き出しに含める", async () => {
    const removed = await repo.createMap("削除済み");
    await repo.deleteMap(removed.map.id);

    const docs = JSON.parse(await exportAllMaps()) as MindMapDocument[];
    expect(docs).toHaveLength(1);
    expect(docs[0].map.deletedAt).not.toBeNull();
  });

  it("既に同じ ID があるマップは上書きせずスキップする", async () => {
    const existing = await repo.createMap("取り込み前");
    const json = await exportAllMaps();

    await repo.renameMap(existing.map.id, "ローカルで編集後");
    const fresh = await repo.createMap("あとから作ったマップ");
    const jsonWithBoth = JSON.stringify([
      ...(JSON.parse(json) as MindMapDocument[]),
      {
        ...fresh,
        map: { ...fresh.map, id: "新しい ID", title: "取り込みで増える" },
        nodes: fresh.nodes.map((node) => ({ ...node, mapId: "新しい ID" })),
      },
    ]);

    expect(await importMaps(jsonWithBoth)).toEqual({ imported: 1, skipped: 1 });

    // 既存のローカル編集が消えていない。
    expect((await repo.getMap(existing.map.id))!.map.title).toBe("ローカルで編集後");
    expect((await repo.getMap("新しい ID"))!.map.title).toBe("取り込みで増える");
  });

  it("壊れた JSON は例外になり、既存データを変更しない", async () => {
    await repo.createMap("無事なマップ");

    await expect(importMaps("{ではない")).rejects.toBeInstanceOf(InvalidDocumentError);
    await expect(importMaps('{"map":{}}')).rejects.toBeInstanceOf(InvalidDocumentError);
    await expect(importMaps("[{}]")).rejects.toBeInstanceOf(InvalidDocumentError);

    expect(await repo.listMaps()).toHaveLength(1);
  });
});
