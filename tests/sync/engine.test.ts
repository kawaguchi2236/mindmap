import { describe, expect, it } from "vitest";
import { migrateGuestMaps, syncAll, type SyncEvent } from "@/features/sync/engine";
import {
  FakeLocalStore,
  FakeRemoteClient,
  makeMap,
  makeNode,
  makeRecord,
  sequentialIds,
} from "./helpers";

/**
 * 同期エンジンの不変条件を守るテスト（ADR-005 §4 / CLAUDE.md §6, §12, §29）。
 * 検証の主眼は「成功したか」ではなく「失敗してもローカルが無事か」。
 */

const DELETED_AT = "2026-09-13T12:00:00.000Z";
const NOW = "2026-09-13T18:00:00.000Z";

function deps(local: FakeLocalStore, remote: FakeRemoteClient, userId: string | null = "u1") {
  return { local, remote, userId, now: () => NOW, newId: sequentialIds() };
}

describe("オフライン → 再接続", () => {
  it("オフライン中は同期に失敗するが、ローカルのデータは 1 件も変わらない", async () => {
    const edited = makeMap({ version: 2, title: "オフラインで書いた" });
    const local = new FakeLocalStore([makeRecord({ syncedVersion: 1, dirty: true, map: edited })]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);
    remote.offline = true;

    const before = await local.listLocal();
    const summary = await syncAll(deps(local, remote));

    expect(summary.abortedReason).toBeDefined();
    expect(summary.pushed).toEqual([]);
    expect(await local.listLocal()).toEqual(before);
    expect(local.putCount).toBe(0);
  });

  it("再接続すると、オフライン中の編集がサーバへ送られる", async () => {
    const edited = makeMap({ version: 2, title: "オフラインで書いた" });
    const local = new FakeLocalStore([makeRecord({ syncedVersion: 1, dirty: true, map: edited })]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.pushed).toEqual(["m1"]);
    expect(summary.failed).toEqual([]);
    expect(remote.maps.get("m1")?.title).toBe("オフラインで書いた");

    const saved = local.peek("m1");
    expect(saved?.dirty).toBe(false);
    expect(saved?.syncedVersion).toBe(2);
    expect(saved?.map.version).toBe(2);
  });

  it("RemoteClient が約束を破って例外を投げても、例外は外へ漏れない", async () => {
    const local = new FakeLocalStore([makeRecord({ syncedVersion: 1, dirty: true })]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);
    remote.throwOn.add("m1");

    const summary = await syncAll(deps(local, remote));

    expect(summary.failed).toEqual([{ mapId: "m1", kind: "network", message: "通信例外: m1" }]);
    expect(local.peek("m1")?.dirty).toBe(true);
  });
});

describe("409 競合", () => {
  it("push が 409 を返しても、ローカル版は複製として必ず残る", async () => {
    const localMap = makeMap({ version: 2, title: "こちらの編集" });
    const serverMap = makeMap({ version: 3, title: "あちらの編集" });
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: localMap }),
    ]);
    // 一覧は version 1 のまま（＝古い）なので decide は push を選ぶが、
    // 実際の PUT で 409 が返る、という競り合いを再現する。
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);
    remote.nextFailure.set("m1", { ok: false, kind: "conflict", serverMap });

    const summary = await syncAll(deps(local, remote));

    expect(summary.conflicts).toHaveLength(1);
    const { mapId, copyId, reason } = summary.conflicts[0];
    expect(mapId).toBe("m1");
    expect(reason).toBe("local-newer");

    // 元 ID にはサーバ版が入る。
    expect(local.peek("m1")?.map.title).toBe("あちらの編集");
    // ローカル版は複製として残る。
    const copy = local.peek(copyId);
    expect(copy?.map.title).toContain("こちらの編集");
    expect(copy?.map.deletedAt).toBeNull();
    expect(copy?.map.nodes).toHaveLength(localMap.nodes.length);
  });

  it("both-modified は追加の通信なしにローカル版を複製して両方残す", async () => {
    const localMap = makeMap({
      version: 5,
      title: "ローカル",
      nodes: [makeNode({ id: "a" }), makeNode({ id: "b", parentId: "a", text: "子" })],
    });
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 2, dirty: true, map: localMap }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 7, title: "サーバ" })]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.conflicts[0].reason).toBe("both-modified");
    const copyId = summary.conflicts[0].copyId;

    expect(local.peek("m1")?.map.title).toBe("サーバ");
    expect(local.peek("m1")?.syncedVersion).toBe(7);

    // 複製はノード ID を振り直しつつ親子関係を保つ。
    const copy = local.peek(copyId);
    expect(copy?.map.nodes).toHaveLength(2);
    const [root, child] = copy!.map.nodes;
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe(root.id);
    expect(root.id).not.toBe("a");
    // 複製もサーバへ送られる。
    expect(remote.maps.has(copyId)).toBe(true);
  });

  it("複製は保存できたがサーバ版を取得できないときは、元 ID を上書きしない", async () => {
    const localMap = makeMap({ version: 5, title: "失いたくないローカル版" });
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 2, dirty: true, map: localMap }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 7, title: "サーバ" })]);
    remote.nextFailure.set("m1", { ok: false, kind: "serverError", message: "500" });

    const summary = await syncAll(deps(local, remote));

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].mapId).toBe("m1");
    // 元 ID はローカル版のまま。取れなかったサーバ版で潰してはいけない。
    expect(local.peek("m1")?.map.title).toBe("失いたくないローカル版");
    expect(local.peek(summary.conflicts[0].copyId)).toBeDefined();
  });

  it("複製の送信に失敗しても、複製はローカルに dirty のまま残る", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 2, dirty: true, map: makeMap({ version: 5 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 7 })]);
    const newId = sequentialIds();
    // 1 ノードぶん消費したあとの ID が複製のマップ ID になる。
    const summary = await syncAll({ local, remote, userId: "u1", now: () => NOW, newId });

    const copyId = summary.conflicts[0].copyId;
    remote.nextFailure.set(copyId, { ok: false, kind: "network" });
    remote.maps.delete(copyId);
    await local.putLocal({ ...local.peek(copyId)!, syncedVersion: 0, dirty: true });

    // 2 回目: 複製の push だけが失敗する。
    const second = await syncAll({ local, remote, userId: "u1", now: () => NOW, newId });
    expect(second.failed.map((f) => f.mapId)).toContain(copyId);
    expect(local.peek(copyId)?.dirty).toBe(true);
    expect(local.peek(copyId)?.map.nodes).toHaveLength(1);
  });
});

describe("部分的な失敗", () => {
  it("1 件が失敗しても、ほかのマップの同期は続行する", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ id: "m1", version: 2 }) }),
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ id: "m2", version: 2 }) }),
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ id: "m3", version: 2 }) }),
    ]);
    const remote = new FakeRemoteClient([
      makeMap({ id: "m1", version: 1 }),
      makeMap({ id: "m2", version: 1 }),
      makeMap({ id: "m3", version: 1 }),
    ]);
    remote.nextFailure.set("m2", { ok: false, kind: "serverError", message: "500" });

    const summary = await syncAll(deps(local, remote));

    expect(summary.pushed.sort()).toEqual(["m1", "m3"]);
    expect(summary.failed).toEqual([{ mapId: "m2", kind: "serverError", message: "500" }]);
    // 失敗したマップは未送信のまま残り、次回再試行される。
    expect(local.peek("m2")?.dirty).toBe(true);
    expect(local.peek("m2")?.syncedVersion).toBe(1);
  });

  it("ローカル保存が失敗しても、ほかのマップの同期は続行する", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ id: "m1", version: 2 }) }),
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ id: "m2", version: 2 }) }),
    ]);
    const remote = new FakeRemoteClient([
      makeMap({ id: "m1", version: 1 }),
      makeMap({ id: "m2", version: 1 }),
    ]);
    local.failOnPut.add("m1");

    const summary = await syncAll(deps(local, remote));

    expect(summary.failed).toEqual([
      { mapId: "m1", kind: "localStore", message: "IndexedDB 書き込み失敗: m1" },
    ]);
    expect(summary.pushed).toEqual(["m2"]);
  });

  it("サーバ一覧が取れないときは、ローカルを一切書き換えずに終了する", async () => {
    const local = new FakeLocalStore([makeRecord({ syncedVersion: 0, dirty: true })]);
    const remote = new FakeRemoteClient();
    remote.nextFailure.set("*", { ok: false, kind: "unauthorized" });

    const summary = await syncAll(deps(local, remote));

    expect(summary.abortedReason).toContain("unauthorized");
    expect(local.putCount).toBe(0);
  });

  it("onEvent が例外を投げても同期は最後まで進む", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ version: 2 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);

    const summary = await syncAll({
      ...deps(local, remote),
      onEvent: () => {
        throw new Error("購読側のバグ");
      },
    });

    expect(summary.pushed).toEqual(["m1"]);
  });
});

describe("削除の伝播", () => {
  it("ローカルの削除をサーバへ伝える", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ version: 2, deletedAt: NOW }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.pushedDeletes).toEqual(["m1"]);
    expect(remote.maps.get("m1")?.deletedAt).not.toBeNull();
  });

  it("サーバの削除を適用してもローカルのノードは消さない", async () => {
    const nodes = [makeNode({ id: "a" }), makeNode({ id: "b", parentId: "a" })];
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ version: 1, nodes }) }),
    ]);
    const remote = new FakeRemoteClient([
      makeMap({ version: 2, deletedAt: DELETED_AT, nodes: [] }),
    ]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.appliedDeletes).toEqual(["m1"]);
    const saved = local.peek("m1");
    expect(saved?.map.deletedAt).toBe(DELETED_AT);
    expect(saved?.map.nodes).toHaveLength(2);
  });

  it("こちらで削除・あちらで編集なら、編集の方を復元する", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ version: 2, deletedAt: NOW }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 4, title: "他デバイスの編集" })]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.restored).toEqual(["m1"]);
    expect(local.peek("m1")?.map.deletedAt).toBeNull();
    expect(local.peek("m1")?.map.title).toBe("他デバイスの編集");
  });

  it("あちらで削除・こちらで編集なら、ローカル版を複製してから削除を適用する", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ version: 3, title: "編集中" }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 2, deletedAt: DELETED_AT })]);

    const summary = await syncAll(deps(local, remote));

    expect(summary.conflicts[0].reason).toBe("remote-deleted-local-modified");
    expect(local.peek("m1")?.map.deletedAt).toBe(DELETED_AT);
    const copy = local.peek(summary.conflicts[0].copyId);
    expect(copy?.map.title).toContain("編集中");
    expect(copy?.map.deletedAt).toBeNull();
    // サーバへの GET は不要（一覧の墓標だけで判断できる）。
    expect(remote.calls).not.toContain("get:m1");
  });
});

describe("初回ログイン時のゲストマップ移行", () => {
  it("ゲストマップは push されたうえでローカルに残る", async () => {
    const local = new FakeLocalStore([
      makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: makeMap({ id: "g1" }) }),
      makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: makeMap({ id: "g2" }) }),
      makeRecord({ userId: "u9", syncedVersion: 3, map: makeMap({ id: "m1", version: 3 }) }),
    ]);
    const remote = new FakeRemoteClient();

    const summary = await migrateGuestMaps({
      local,
      remote,
      userId: "u9",
      now: () => NOW,
      newId: sequentialIds(),
    });

    expect(summary.pushed.sort()).toEqual(["g1", "g2"]);
    // ローカルから消えていないこと。ここが最重要。
    expect([...local.records.keys()].sort()).toEqual(["g1", "g2", "m1"]);
    expect(local.peek("g1")?.userId).toBe("u9");
    expect(local.peek("g1")?.dirty).toBe(false);
    // 所有者の付け替えは claimLocal（＝担当 A の claimMap）で行う。
    expect(local.claimed).toEqual([
      { mapId: "g1", userId: "u9" },
      { mapId: "g2", userId: "u9" },
    ]);
    expect(remote.maps.has("g2")).toBe(true);
    // 既にユーザーへ紐づいているマップには触らない。
    expect(remote.maps.has("m1")).toBe(false);
  });

  it("送信に失敗したゲストマップはゲストのまま残り、次回に再試行できる", async () => {
    const local = new FakeLocalStore([
      makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: makeMap({ id: "g1" }) }),
      makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: makeMap({ id: "g2" }) }),
    ]);
    const remote = new FakeRemoteClient();
    remote.nextFailure.set("g1", { ok: false, kind: "network" });

    const summary = await migrateGuestMaps({
      local,
      remote,
      userId: "u9",
      now: () => NOW,
      newId: sequentialIds(),
    });

    expect(summary.pushed).toEqual(["g2"]);
    expect(summary.failed.map((f) => f.mapId)).toEqual(["g1"]);
    expect(local.peek("g1")?.userId).toBeNull();
    expect(local.peek("g1")?.dirty).toBe(true);
    expect(local.peek("g1")?.map.nodes).toHaveLength(1);
  });

  it("サーバに同じ ID が既にあれば、ゲスト版を複製して両方残す", async () => {
    const local = new FakeLocalStore([
      makeRecord({
        userId: null,
        syncedVersion: 0,
        dirty: true,
        map: makeMap({ id: "g1", title: "ゲストの下書き" }),
      }),
    ]);
    // 別デバイスで移行済み、という状況。
    const remote = new FakeRemoteClient([makeMap({ id: "g1", version: 4, title: "移行済み" })]);

    const summary = await migrateGuestMaps({
      local,
      remote,
      userId: "u9",
      now: () => NOW,
      newId: sequentialIds(),
    });

    expect(summary.conflicts).toHaveLength(1);
    const copy = local.peek(summary.conflicts[0].copyId);
    expect(copy?.map.title).toContain("ゲストの下書き");
    expect(copy?.userId).toBe("u9");
    expect(local.peek("g1")?.map.title).toBe("移行済み");
  });
});

describe("ADR-005 #17 push に対する 404（サーバ側に行が無い）", () => {
  it("baseVersion 0 で作り直して復活させる", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 3, dirty: true, map: makeMap({ version: 4 }) }),
    ]);
    // 一覧にはあるが、PUT の時点で行が消える（別デバイスが物理削除した）。
    const remote = new FakeRemoteClient([makeMap({ version: 3 })]);
    remote.vanishOnPut.add("m1");

    const summary = await syncAll(deps(local, remote));

    expect(summary.pushed).toEqual(["m1"]);
    expect(summary.failed).toEqual([]);
    expect(remote.maps.get("m1")?.version).toBe(1);
    expect(local.peek("m1")?.syncedVersion).toBe(1);
    expect(local.peek("m1")?.dirty).toBe(false);
  });

  it("再試行は 1 回だけ。2 度目の 404 は失敗として記録しループしない", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 3, dirty: true, map: makeMap({ version: 4 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 3 })]);
    // 何度呼ばれても 404 を返す（別ユーザーが同じ ID を持っている場合など）。
    remote.alwaysFail.set("m1", { ok: false, kind: "notFound" });

    const summary = await syncAll(deps(local, remote));

    expect(summary.failed).toEqual([{ mapId: "m1", kind: "notFound", message: "notFound" }]);
    expect(remote.calls.filter((c) => c === "put:m1")).toHaveLength(2);
    // ローカルは無傷のまま、次回また再試行できる。
    expect(local.peek("m1")?.dirty).toBe(true);
    expect(local.peek("m1")?.map.version).toBe(4);
  });
});

describe("ADR-005 #18 書き込み直前にローカルが変わっていた（StaleWriteError）", () => {
  it("判断からやり直して、2 回目で書き戻せる", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ version: 1 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 5, title: "サーバ版" })]);
    local.staleOnPut.add("m1"); // 1 度だけ拒否される

    const summary = await syncAll(deps(local, remote));

    expect(summary.pulled).toEqual(["m1"]);
    expect(summary.failed).toEqual([]);
    expect(local.peek("m1")?.map.title).toBe("サーバ版");
    expect(local.putCount).toBe(2);
  });

  it("読み直した結果に応じて別の動作に切り替わる", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ version: 1 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 5, title: "サーバ版" })]);

    // pull を決めたあと、書き込む直前にユーザーがローカルを編集した。
    local.beforePut = () => {
      local.beforePut = undefined;
      local.records.set("m1", {
        ...local.peek("m1")!,
        dirty: true,
        map: { ...local.peek("m1")!.map, version: 9, title: "書き込み直前の編集" },
      });
    };

    const summary = await syncAll(deps(local, remote));

    // 読み直すと both-modified。ローカル版は複製として必ず残る。
    expect(summary.conflicts).toHaveLength(1);
    expect(summary.conflicts[0].reason).toBe("both-modified");
    const copy = local.peek(summary.conflicts[0].copyId);
    expect(copy?.map.title).toContain("書き込み直前の編集");
    expect(local.peek("m1")?.map.title).toBe("サーバ版");
  });

  it("リトライは 1 回まで。2 度目の拒否は failed に記録してループしない", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ version: 1 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 5 })]);
    local.alwaysStaleOnPut.add("m1");

    const summary = await syncAll(deps(local, remote));

    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].kind).toBe("localStore");
    expect(local.putCount).toBe(2); // 初回 + 出直し 1 回だけ
    // ローカルは無傷。
    expect(local.peek("m1")?.map.version).toBe(1);
  });

  it("expectedLocalVersion に「判断材料として読んだ version」を渡す", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ id: "m1", version: 1 }) }),
    ]);
    const remote = new FakeRemoteClient([
      makeMap({ id: "m1", version: 5 }),
      makeMap({ id: "m2", version: 2 }), // ローカルに無いマップ
    ]);

    await syncAll(deps(local, remote));

    expect(local.putCalls).toContainEqual({ id: "m1", expected: 1 });
    // ローカルにまだ無いマップは「存在しないこと」を期待する。
    expect(local.putCalls).toContainEqual({ id: "m2", expected: null });
  });
});

describe("物理削除を決して呼ばない", () => {
  it("通常同期でも初回ログイン移行でも deleteLocalHard を呼ばない", async () => {
    const local = new FakeLocalStore([
      makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: makeMap({ id: "g1" }) }),
      makeRecord({
        syncedVersion: 1,
        dirty: true,
        map: makeMap({ id: "m1", version: 2, deletedAt: NOW }),
      }),
      makeRecord({ syncedVersion: 1, dirty: false, map: makeMap({ id: "m2", version: 1 }) }),
    ]);
    const remote = new FakeRemoteClient([
      makeMap({ id: "m1", version: 1 }),
      makeMap({ id: "m2", version: 3, deletedAt: DELETED_AT }),
    ]);

    await migrateGuestMaps({ local, remote, userId: "u9", now: () => NOW, newId: sequentialIds() });
    await syncAll(deps(local, remote, "u9"));

    expect(local.hardDeleted).toEqual([]);
    // ゲストマップも削除済みマップもローカルに残っている。
    expect([...local.records.keys()].sort()).toContain("g1");
    expect(local.peek("m2")?.map.nodes).toHaveLength(1);
  });
});

describe("イベント通知", () => {
  it("判定・成功・完了を順に通知する", async () => {
    const local = new FakeLocalStore([
      makeRecord({ syncedVersion: 1, dirty: true, map: makeMap({ version: 2 }) }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ version: 1 })]);
    const events: SyncEvent[] = [];

    await syncAll({ ...deps(local, remote), onEvent: (e) => events.push(e) });

    expect(events.map((e) => e.type)).toEqual([
      "sync-started",
      "map-decided",
      "map-succeeded",
      "sync-finished",
    ]);
  });
});
