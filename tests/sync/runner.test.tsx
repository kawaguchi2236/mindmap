import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/features/auth/SessionProvider";
import { SyncRunner } from "@/features/sync";
import { MIN_SYNC_INTERVAL_MS } from "@/features/sync/useSyncRunner";
import type { MapSummary, SyncMap } from "@/features/sync/protocol";
import type { LocalMapRecord, RemoteResult } from "@/features/sync/types";
import { FakeLocalStore, FakeRemoteClient, makeMap, makeRecord, toSummary } from "./helpers";

/**
 * `<SyncRunner />` の起動条件のテスト。
 *
 * 「何をどう同期するか」は engine.test.ts / decide.test.ts が見ている。
 * ここが見るのは **いつ走らせるか／いつ絶対に走らせないか** だけ:
 *
 *   - ゲストでは 1 回も通信しない
 *   - オフラインのあいだは走らない（`navigator.onLine` を見る）
 *   - 多重に走らない
 *   - アンマウントしたら止まる
 *   - 失敗しても例外を外に出さない
 *   - ゲスト移行は 1 回だけ
 *
 * ここで緑でも実ブラウザでの同期は検証できていない（Neon も認証も未接続）。
 * 検証しているのはフェイクを相手にしたロジックまで。
 */

/** jsdom の `navigator.onLine` は書き換えられないので、自前の記述子をかぶせる。 */
function setNavigatorOnline(value: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value });
}

function fireConnectivity(type: "online" | "offline"): void {
  window.dispatchEvent(new Event(type));
}

/** マウント直後の非同期処理を流し切る。 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function tick(ms = MIN_SYNC_INTERVAL_MS): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** セッション取得口を差し替えるテストがあるので、本物を退避しておく。 */
const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
  setNavigatorOnline(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ゲストでは一切通信しない", () => {
  it("マウントしても・時間が経っても・再接続しても 1 回も呼ばれない", async () => {
    const local = new FakeLocalStore([makeRecord({ userId: null, syncedVersion: 0, dirty: true })]);
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId={null} local={local} remote={remote} />);
    await settle();
    await tick();
    fireConnectivity("online");
    await settle();

    expect(remote.calls).toEqual([]);
    // ローカルも触らない。ゲストのマップが同期の都合で書き換わることはない。
    expect(local.putCount).toBe(0);
    expect(local.claimed).toEqual([]);
  });

  it("同期状態を何も描かない（ログインしていないことを欠陥のように見せない）", async () => {
    render(
      <SyncRunner userId={null} local={new FakeLocalStore()} remote={new FakeRemoteClient()} />,
    );
    await settle();

    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("オフライン", () => {
  it("オフラインでマウントしても通信しない", async () => {
    setNavigatorOnline(false);
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();
    await tick();

    expect(remote.calls).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("オフライン");
  });

  it("online イベントが来ても navigator.onLine が false なら走らない", async () => {
    setNavigatorOnline(false);
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();
    fireConnectivity("online");
    await settle();

    expect(remote.calls).toEqual([]);
  });

  it("接続が戻ったら online イベントで同期する", async () => {
    setNavigatorOnline(false);
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();
    expect(remote.calls).toEqual([]);

    setNavigatorOnline(true);
    fireConnectivity("online");
    await settle();

    expect(remote.calls).toEqual(["list"]);
    expect(screen.getByRole("status")).toHaveTextContent("同期済み");
  });

  it("offline イベントでオフライン表示に変わる（操作はブロックしない）", async () => {
    const remote = new FakeRemoteClient();
    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("同期済み");

    setNavigatorOnline(false);
    fireConnectivity("offline");
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("オフライン");
  });
});

describe("多重起動しない", () => {
  it("前回が終わる前に周期・再接続が重なっても同時には 1 本だけ", async () => {
    const local = new FakeLocalStore();
    const remote = new BlockingRemoteClient();

    render(<SyncRunner userId="u1" local={local} remote={remote} />);
    await settle();
    expect(remote.listStarted).toBe(1);
    expect(screen.getByRole("status")).toHaveTextContent("同期中");

    // 走っている最中に、来うるきっかけを全部ぶつける。
    fireConnectivity("online");
    await settle();
    await tick();
    await tick();
    expect(remote.listStarted).toBe(1);

    // 終わったあとの周期では、ちゃんと次が走る。
    remote.releaseList();
    await settle();
    await tick();
    expect(remote.listStarted).toBe(2);
  });

  it("ポーリング間隔は 60 秒より短くできない", async () => {
    const remote = new FakeRemoteClient();
    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} intervalMs={10} />);
    await settle();
    expect(remote.calls).toEqual(["list"]);

    await tick(MIN_SYNC_INTERVAL_MS - 1);
    expect(remote.calls).toEqual(["list"]);

    await tick(1);
    expect(remote.calls).toEqual(["list", "list"]);
  });
});

describe("アンマウント", () => {
  it("タイマーもリスナも止まり、以降は何も起きない", async () => {
    const remote = new FakeRemoteClient();
    const { unmount } = render(
      <SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />,
    );
    await settle();
    expect(remote.calls).toEqual(["list"]);

    unmount();
    await tick();
    await tick();
    fireConnectivity("online");
    await settle();

    expect(remote.calls).toEqual(["list"]);
  });

  it("走っている最中にアンマウントしても、結果でアンマウント後の状態を触らない", async () => {
    const local = new FakeLocalStore();
    // 取り込むものがある状態にしておく。生きていれば必ず onLocalChanged が呼ばれる。
    const remote = new BlockingRemoteClient([makeMap({ id: "m9", version: 2 })]);
    const onLocalChanged = vi.fn();

    const { unmount } = render(
      <SyncRunner userId="u1" local={local} remote={remote} onLocalChanged={onLocalChanged} />,
    );
    await settle();
    unmount();

    remote.releaseList();
    await settle();

    // React の「アンマウント済みコンポーネントの更新」も、未処理の例外も出さない。
    expect(onLocalChanged).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("失敗してもアプリを落とさない", () => {
  it("ネットワーク失敗は失敗表示になるだけで、例外は外へ出ない", async () => {
    const remote = new FakeRemoteClient();
    remote.offline = true; // 到達できない（navigator はオンラインのまま）

    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("同期に失敗しました");
    // 次の周期で黙って再試行する。ユーザーに操作を求めない。
    await tick();
    expect(remote.calls).toEqual(["list", "list"]);
  });

  it("RemoteClient が約束を破って例外を投げても落ちない", async () => {
    const remote = new FakeRemoteClient();
    remote.throwOn.add("*"); // listSummaries が throw する

    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={remote} />);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("同期に失敗しました");
  });

  it("ローカル保存が壊れていても落ちない", async () => {
    const broken = new FakeLocalStore();
    broken.listLocal = () => Promise.reject(new Error("IndexedDB を開けません"));
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId="u1" local={broken} remote={remote} />);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("同期に失敗しました");
  });
});

describe("ゲストマップの移行", () => {
  it("ログイン後の最初の 1 回だけ移行し、以降の周期では呼ばない", async () => {
    const local = new CountingLocalStore([
      makeRecord({ map: { id: "guest-1" }, userId: null, syncedVersion: 0, dirty: true }),
    ]);
    const remote = new FakeRemoteClient();

    render(<SyncRunner userId="u1" local={local} remote={remote} />);
    await settle();

    // 所有者を付け替えるだけ。削除して作り直さない（ADR-005 §3.4）。
    expect(local.claimed).toEqual([{ mapId: "guest-1", userId: "u1" }]);
    expect(local.hardDeleted).toEqual([]);
    expect(local.peek("guest-1")?.userId).toBe("u1");
    // 移行 1 回 + 突き合わせ 1 回。どちらも一覧を 1 度ずつ読む。
    expect(local.listCount).toBe(2);

    await tick();
    await tick();
    fireConnectivity("online");
    await settle();

    expect(local.claimed).toEqual([{ mapId: "guest-1", userId: "u1" }]);
    // 以降は突き合わせだけ。移行はもう走らない（毎回呼ばないこと）。
    expect(local.listCount).toBe(5);
  });

  it("移行に失敗したら次の周期で再試行する（ゲストのまま取り残さない）", async () => {
    const local = new FakeLocalStore([
      makeRecord({ map: { id: "guest-1" }, userId: null, syncedVersion: 0, dirty: true }),
    ]);
    const remote = new FakeRemoteClient();
    remote.offline = true; // 1 回目はサーバに届かない

    render(<SyncRunner userId="u1" local={local} remote={remote} />);
    await settle();
    // 送れなかったマップはゲストのまま・未送信のまま残る（ADR-005 §3.4）。
    expect(local.claimed).toEqual([]);
    expect(local.peek("guest-1")?.userId).toBeNull();
    expect(local.peek("guest-1")?.dirty).toBe(true);

    remote.offline = false;
    await tick();
    expect(local.claimed).toEqual([{ mapId: "guest-1", userId: "u1" }]);
  });
});

describe("ローカルが変わったときだけ知らせる", () => {
  it("取り込むものがあれば呼ばれる", async () => {
    const remoteMap: SyncMap = makeMap({ id: "m9", version: 3 });
    const remote = new FakeRemoteClient([remoteMap]);
    const onLocalChanged = vi.fn();

    render(
      <SyncRunner
        userId="u1"
        local={new FakeLocalStore()}
        remote={remote}
        onLocalChanged={onLocalChanged}
      />,
    );
    await settle();

    expect(onLocalChanged).toHaveBeenCalledTimes(1);
  });

  it("何も動かなければ呼ばない（60 秒ごとに一覧を読み直させない）", async () => {
    const map = makeMap({ id: "m1", version: 1 });
    const local = new FakeLocalStore([makeRecord({ map, syncedVersion: 1, dirty: false })]);
    const remote = new FakeRemoteClient([map]);
    const onLocalChanged = vi.fn();

    render(
      <SyncRunner userId="u1" local={local} remote={remote} onLocalChanged={onLocalChanged} />,
    );
    await settle();
    await tick();

    expect(onLocalChanged).not.toHaveBeenCalled();
  });
});

describe("状態表示を出さずに同期だけ回す", () => {
  it("showStatus={false} なら DOM には何も足さないが、同期は走る", async () => {
    const remote = new FakeRemoteClient();
    const { container } = render(
      <SyncRunner userId="u1" showStatus={false} local={new FakeLocalStore()} remote={remote} />,
    );
    await settle();

    // エディタのキャンバス上に常駐する文字列を増やさない（CLAUDE.md §9 / §17）。
    expect(screen.queryByRole("status")).toBeNull();
    expect(container).toBeEmptyDOMElement();
    // それでも同期は回っている。表示を消すだけで、仕事は止めない。
    expect(remote.calls).toEqual(["list"]);

    await tick();
    expect(remote.calls).toEqual(["list", "list"]);
  });

  it("既定では従来どおり状態を出す（/maps・/settings の見た目を変えない）", async () => {
    render(<SyncRunner userId="u1" local={new FakeLocalStore()} remote={new FakeRemoteClient()} />);
    await settle();

    expect(screen.getByRole("status")).toHaveTextContent("同期済み");
  });
});

describe("userId を省略したときはセッションから引く", () => {
  it("ログイン中なら、その ID で同期が走る", async () => {
    const local = new FakeLocalStore([
      makeRecord({ map: { id: "guest-1" }, userId: null, syncedVersion: 0, dirty: true }),
    ]);
    const remote = new FakeRemoteClient();
    stubSessionFetch({
      user: { id: "u7", email: "a@example.com", name: null },
      expires: "2999-01-01T00:00:00.000Z",
    });

    render(
      <AuthSessionProvider>
        <SyncRunner showStatus={false} local={local} remote={remote} />
      </AuthSessionProvider>,
    );
    await settle();

    expect(remote.calls).toContain("list");
    // セッションから引いた ID がそのまま使われている（別の値に化けていない）。
    expect(local.claimed).toEqual([{ mapId: "guest-1", userId: "u7" }]);
  });

  it("ゲスト（Provider も無い）なら 1 回も通信しない", async () => {
    const local = new FakeLocalStore([makeRecord({ userId: null, syncedVersion: 0, dirty: true })]);
    const remote = new FakeRemoteClient();

    render(<SyncRunner showStatus={false} local={local} remote={remote} />);
    await settle();
    await tick();

    expect(remote.calls).toEqual([]);
    expect(local.putCount).toBe(0);
  });

  it("セッションの取得に失敗してもゲストのまま、通信しない", async () => {
    const remote = new FakeRemoteClient();
    stubSessionFetch(null, { ok: false });

    render(
      <AuthSessionProvider>
        <SyncRunner local={new FakeLocalStore()} remote={remote} />
      </AuthSessionProvider>,
    );
    await settle();

    expect(remote.calls).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("明示的に渡した userId が優先される（セッションを待たない）", async () => {
    const local = new FakeLocalStore([
      makeRecord({ map: { id: "guest-1" }, userId: null, syncedVersion: 0, dirty: true }),
    ]);
    const remote = new FakeRemoteClient();
    // セッションは返ってこない。それでも渡された ID で同期は始まる。
    stubSessionFetch(new Promise<never>(() => {}));

    render(
      <AuthSessionProvider>
        <SyncRunner userId="u1" showStatus={false} local={local} remote={remote} />
      </AuthSessionProvider>,
    );
    await settle();

    expect(local.claimed).toEqual([{ mapId: "guest-1", userId: "u1" }]);
  });

  it("userId={null} は「ゲストだと分かっている」の意味で、セッションを見ない", async () => {
    const remote = new FakeRemoteClient();
    stubSessionFetch({
      user: { id: "u7", email: "a@example.com", name: null },
      expires: "2999-01-01T00:00:00.000Z",
    });

    render(
      <AuthSessionProvider>
        <SyncRunner userId={null} local={new FakeLocalStore()} remote={remote} />
      </AuthSessionProvider>,
    );
    await settle();

    expect(remote.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// テスト用の道具
// ---------------------------------------------------------------------------

/**
 * `/api/auth/session` の応答を差し替える。
 *
 * `body` に Promise を渡すと、解決するまで「取得中」のままにできる。
 * afterEach で本物の fetch に戻している。
 */
function stubSessionFetch(body: unknown, options?: { ok?: boolean }): void {
  globalThis.fetch = vi.fn(() => {
    if (body instanceof Promise) return body;
    return Promise.resolve({
      ok: options?.ok ?? true,
      json: () => Promise.resolve(body),
    } as Response);
  }) as unknown as typeof fetch;
}

/** 一覧の読み込み回数を数える `LocalStore`。移行が 1 回だけかを見るのに使う。 */
class CountingLocalStore extends FakeLocalStore {
  /** `listLocal()` が呼ばれた回数。1 回の同期で「移行 + 突き合わせ」なら 2 になる。 */
  listCount = 0;

  override async listLocal(): Promise<LocalMapRecord[]> {
    this.listCount += 1;
    return super.listLocal();
  }
}

/** 一覧取得を任意のタイミングまで止められる `RemoteClient`。多重起動の検証に使う。 */
class BlockingRemoteClient extends FakeRemoteClient {
  /** `listSummaries` に入った回数（返した回数ではない）。 */
  listStarted = 0;
  private release: (() => void) | null = null;

  override async listSummaries(): Promise<RemoteResult<MapSummary[]>> {
    this.listStarted += 1;
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    this.calls.push("list");
    return { ok: true, data: [...this.maps.values()].map((m) => toSummary(m)) };
  }

  releaseList(): void {
    this.release?.();
    this.release = null;
  }
}
