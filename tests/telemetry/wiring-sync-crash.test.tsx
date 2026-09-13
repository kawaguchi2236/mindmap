import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSyncRunner } from "@/features/sync/useSyncRunner";
import { FakeLocalStore, FakeRemoteClient, makeRecord } from "../sync/helpers";

/**
 * `useSyncRunner` の `catch`（= 同期中に予期しない例外が出た経路）の検証。
 *
 * engine 自身は「例外を投げない」を律儀に守っているので、**呼び出し側のコールバック**
 * （`onLocalChanged`）に投げさせてこの経路へ入る。engine をモックしないので、
 * 実際の同期がひと通り走ったうえでの例外になる。
 *
 * 見るのは 3 つ:
 *   1. エラー監視に届くこと（黙って消えない）
 *   2. 送る中身に**マップのタイトルなど利用者が書いたものが混ざらない**こと
 *   3. 例外のあともアプリが壊れず、**次の機会にまた同期が走る**こと
 *
 * 偽タイマーは使わない（`act` と噛み合わず固まる）。2 回目は `online` イベントで起こす。
 */

const ENDPOINT = "https://errors.example.test/report";
const EVENTS_ENDPOINT = "https://collector.example.test/events";
/** 例外メッセージに混ざった、外へ出してはいけない文字列。 */
const SECRET = "四半期の目標（マップのタイトル）";

function sentBodies(): string {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map(([, init]) => String(init.body)).join("\n");
}

function sentReports(): Record<string, unknown>[] {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
}

/** 計測イベントだけを送信順に取り出す（エラー報告は別の送信先なので除ける）。 */
function sentEvents(): { name: string; properties: Record<string, unknown> }[] {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls
    .filter(([url]) => url === EVENTS_ENDPOINT)
    .map(([, init]) => JSON.parse(String(init.body)));
}

function eventNames(): string[] {
  return sentEvents().map((event) => event.name);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

/** 同期の終わりに必ず投げるエラー。スタックは V8 形式を手で置く。 */
function crash(): Error {
  const error = new TypeError(`保存に失敗しました: ${SECRET}`);
  error.stack = `TypeError: 保存に失敗しました: ${SECRET}\n    at apply (/src/features/sync/useSyncRunner.ts:110:7)`;
  return error;
}

/**
 * `local` / `remote` は**必ずレンダー callback の外で作る**。
 * 中で `new` すると毎レンダーで別物になり、`useSyncRunner` の effect の依存が
 * 毎回変わって同期が無限に再起動する（テストが固まる）。
 */
function renderRunner(onLocalChanged: () => void) {
  const local = new FakeLocalStore([makeRecord({ dirty: true })]);
  const remote = new FakeRemoteClient();
  const view = renderHook(() => useSyncRunner({ userId: "u1", local, remote, onLocalChanged }));
  return { remote, view };
}

beforeEach(() => {
  Object.defineProperty(navigator, "sendBeacon", {
    value: undefined,
    configurable: true,
    writable: true,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
  vi.stubEnv("NODE_ENV", "production");
  // エラーの送信先だけ設定する。イベント側は未設定なので、届くのはエラー報告だけ。
  vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", ENDPOINT);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("同期中に予期しない例外が出たとき", () => {
  it("エラー監視に報告する", async () => {
    renderRunner(() => {
      throw crash();
    });
    await settle();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(sentReports()[0]).toMatchObject({ name: "TypeError", where: "sync" });
  });

  it("例外メッセージ本文を送らない（マップのタイトルが混ざりうる）", async () => {
    renderRunner(() => {
      throw crash();
    });
    await settle();

    expect(sentBodies()).not.toContain("四半期の目標");
    expect(sentBodies()).not.toContain("マップのタイトル");
    const report = sentReports()[0];
    expect(Object.keys(report).sort()).toEqual(["at", "frames", "name", "where"]);
    expect(report.frames).toEqual(["at apply (/src/features/sync/useSyncRunner.ts:110:7)"]);
  });

  it("例外が出なければ報告しない", async () => {
    renderRunner(() => {});
    await settle();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("例外のあともまた同期が走る（多重起動ガードが解放される）", async () => {
    let shouldThrow = true;
    const { remote } = renderRunner(() => {
      if (shouldThrow) throw crash();
    });
    await settle();

    const afterCrash = remote.calls.filter((call) => call === "list").length;
    expect(afterCrash).toBe(1);

    // 再接続で 2 回目。runningRef が握られたままなら走らない。
    shouldThrow = false;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await settle();

    expect(remote.calls.filter((call) => call === "list").length).toBe(2);
  });

  it("送信先が未設定でも落ちず、何も送らない", async () => {
    vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", "");
    renderRunner(() => {
      throw crash();
    });
    await settle();

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("報告の送信そのものが失敗してもアプリは落ちない", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    renderRunner(() => {
      throw crash();
    });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
  });
});

describe("例外で落ちた同期も失敗として数える", () => {
  beforeEach(() => {
    // この describe だけイベントの送信先も設定する（上の describe はエラーのみ）。
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", EVENTS_ENDPOINT);
  });

  it("ゲストマップ移行で落ちたとき sync_failed が 1 回だけ出る", async () => {
    // ゲストのマップ（userId: null）があると移行が走り、その通知で投げる。
    // syncAll まで到達しないので sync_completed は出ない。
    const local = new FakeLocalStore([makeRecord({ userId: null, dirty: true })]);
    const remote = new FakeRemoteClient();
    renderHook(() =>
      useSyncRunner({
        userId: "u1",
        local,
        remote,
        onLocalChanged: () => {
          throw crash();
        },
      }),
    );
    await settle();

    expect(eventNames()).toEqual(["sync_failed"]);
    expect(sentEvents()[0].properties).toEqual({ reason: "unknown" });
  });

  it("例外の理由に自由文字列を混ぜない", async () => {
    const local = new FakeLocalStore([makeRecord({ userId: null, dirty: true })]);
    const remote = new FakeRemoteClient();
    renderHook(() =>
      useSyncRunner({
        userId: "u1",
        local,
        remote,
        onLocalChanged: () => {
          throw crash();
        },
      }),
    );
    await settle();

    expect(sentBodies()).not.toContain("四半期の目標");
    expect(sentBodies()).not.toContain("保存に失敗しました");
  });

  it("例外が出なければ sync_failed は出ない", async () => {
    const local = new FakeLocalStore([makeRecord({ userId: null, dirty: true })]);
    const remote = new FakeRemoteClient();
    renderHook(() => useSyncRunner({ userId: "u1", local, remote, onLocalChanged: () => {} }));
    await settle();

    expect(eventNames()).not.toContain("sync_failed");
  });

  it("同期が終わったあとで落ちた場合は sync_completed のあとに sync_failed が続く", async () => {
    /*
     * 記録のためのテスト。`onLocalChanged` は `apply()` の中で呼ばれるので、
     * 同期自体は成功して sync_completed が出たあとに例外が起きる。
     * 2 件出るのは正しい（同期は終わった／そのあと何かが壊れた）。
     * 見落としたくないのは失敗のほうなので、多めに出る分には害がない。
     */
    const local = new FakeLocalStore([makeRecord({ dirty: true })]);
    const remote = new FakeRemoteClient();
    renderHook(() =>
      useSyncRunner({
        userId: "u1",
        local,
        remote,
        onLocalChanged: () => {
          throw crash();
        },
      }),
    );
    await settle();

    expect(eventNames()).toEqual(["sync_completed", "sync_failed"]);
  });
});
