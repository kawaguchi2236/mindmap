/**
 * 同期エンジン（担当 B）向けに追加した API のテスト。
 * 焦点は「意図しない書き込みが起きないこと」と「既存データが無傷なこと」。
 */

import { beforeEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getRepository, resetRepositoryForTests } from "@/lib/db";
import { MapNotFoundError, StaleWriteError } from "@/lib/db/errors";
import type { MapRepository } from "@/lib/db/types";
import type { MindMapDocument } from "@/lib/model/types";

let repo: MapRepository;

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  repo = getRepository();
});

/** サーバから降ってきたことにしたドキュメントを作る。 */
function fromServer(doc: MindMapDocument, version: number, title: string): MindMapDocument {
  return {
    ...doc,
    map: {
      ...doc.map,
      title,
      version,
      updatedAt: "2026-09-13T09:00:00.000Z",
    },
  };
}

describe("listMaps({ includeDeleted })", () => {
  it("既定では墓標を出さず、includeDeleted で出す", async () => {
    const alive = await repo.createMap("生きているマップ");
    const removed = await repo.createMap("消したマップ");
    await repo.deleteMap(removed.map.id);

    expect((await repo.listMaps()).map((m) => m.id)).toEqual([alive.map.id]);

    const all = await repo.listMaps({ includeDeleted: true });
    expect(all.map((m) => m.id).sort()).toEqual([alive.map.id, removed.map.id].sort());

    const tombstone = all.find((m) => m.id === removed.map.id)!;
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.userId).toBeNull();
  });

  it("サマリに userId と deletedAt が入る", async () => {
    const created = await repo.createMap("所有者つき");
    await repo.claimMap(created.map.id, "user-1");

    const [summary] = await repo.listMaps();
    expect(summary.userId).toBe("user-1");
    expect(summary.deletedAt).toBeNull();
    expect(summary.nodeCount).toBe(1);
  });
});

describe("getMap({ includeDeleted })", () => {
  it("既定では墓標に null、includeDeleted なら中身を返す", async () => {
    const created = await repo.createMap("墓標");
    await repo.deleteMap(created.map.id);

    expect(await repo.getMap(created.map.id)).toBeNull();

    const loaded = await repo.getMap(created.map.id, { includeDeleted: true });
    expect(loaded).not.toBeNull();
    expect(loaded!.map.deletedAt).not.toBeNull();
    expect(loaded!.nodes).toHaveLength(1);
  });
});

describe("saveMapFromServer", () => {
  it("サーバの version と updatedAt をそのまま保存する（+1 しない）", async () => {
    const local = await repo.createMap("ローカル");
    const server = fromServer(local, 42, "サーバ版");

    const saved = await repo.saveMapFromServer(server, {
      expectedLocalVersion: local.map.version,
    });
    expect(saved.map.version).toBe(42);

    const loaded = await repo.getMap(local.map.id);
    expect(loaded!.map.version).toBe(42);
    expect(loaded!.map.updatedAt).toBe("2026-09-13T09:00:00.000Z");
    expect(loaded!.map.title).toBe("サーバ版");
  });

  it("サーバ版の version がローカルより小さくても、期待どおりなら通る", async () => {
    const local = await repo.createMap("ローカル");
    const bumped = await repo.saveMap(local); // version 2
    const server = fromServer(local, 1, "巻き戻し");

    await expect(
      repo.saveMapFromServer(server, { expectedLocalVersion: bumped.map.version }),
    ).resolves.toBeTruthy();
    expect((await repo.getMap(local.map.id))!.map.version).toBe(1);
  });

  it("expectedLocalVersion が食い違うと StaleWriteError になり、既存レコードは無傷", async () => {
    const local = await repo.createMap("競合");
    // 同期の判断中にローカルが編集された想定。
    const edited = await repo.saveMap({
      ...local,
      nodes: [{ ...local.nodes[0], text: "編集中の内容" }],
    });

    const error = await repo
      .saveMapFromServer(fromServer(local, 99, "サーバ版"), {
        expectedLocalVersion: local.map.version,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StaleWriteError);
    // 担当 B は name で判定している。
    expect((error as Error).name).toBe("StaleWriteError");

    const loaded = await repo.getMap(local.map.id);
    expect(loaded!.map.version).toBe(edited.map.version);
    expect(loaded!.map.title).toBe("競合");
    expect(loaded!.nodes[0].text).toBe("編集中の内容");
  });

  it("expectedLocalVersion: null はローカルに無いことを期待する", async () => {
    const fresh = await repo.createMap("一時的なひな形");
    const brandNew = { ...fresh, map: { ...fresh.map, id: "server-only" } };
    const server = {
      ...brandNew,
      nodes: brandNew.nodes.map((n) => ({ ...n, mapId: "server-only" })),
    };

    await expect(
      repo.saveMapFromServer(server, { expectedLocalVersion: null }),
    ).resolves.toBeTruthy();
    expect((await repo.getMap("server-only"))!.map.title).toBe("一時的なひな形");

    // 2 回目は既に存在するので拒否される。
    await expect(
      repo.saveMapFromServer(server, { expectedLocalVersion: null }),
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it("ローカルに無いのに数値を期待した場合も拒否し、何も書き込まない", async () => {
    const fresh = await repo.createMap("ひな形");
    const server = {
      ...fresh,
      map: { ...fresh.map, id: "missing-locally" },
      nodes: fresh.nodes.map((n) => ({ ...n, mapId: "missing-locally" })),
    };

    await expect(
      repo.saveMapFromServer(server, { expectedLocalVersion: 3 }),
    ).rejects.toBeInstanceOf(StaleWriteError);
    expect(await repo.getMap("missing-locally")).toBeNull();
  });

  it("options 省略時は無条件に書き込む", async () => {
    const local = await repo.createMap("無条件");
    await repo.saveMapFromServer(fromServer(local, 7, "上書き"));
    expect((await repo.getMap(local.map.id))!.map.version).toBe(7);
  });
});

describe("claimMap", () => {
  it("userId を立てるだけで version と updatedAt を変えない", async () => {
    const created = await repo.createMap("引き継ぎ対象");
    const before = (await repo.getMap(created.map.id))!;

    await repo.claimMap(created.map.id, "user-1");

    const after = (await repo.getMap(created.map.id))!;
    expect(after.map.userId).toBe("user-1");
    expect(after.map.version).toBe(before.map.version);
    expect(after.map.updatedAt).toBe(before.map.updatedAt);
    expect(after.nodes).toEqual(before.nodes);
  });

  it("存在しないマップでは MapNotFoundError になる", async () => {
    await expect(repo.claimMap("missing", "user-1")).rejects.toBeInstanceOf(MapNotFoundError);
  });
});
