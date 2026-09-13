import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * イベント送信の検証（CLAUDE.md §31）。
 *
 * 固定したいのは3つ:
 * 1. 送信先が未設定なら本番では**何も送らない**
 * 2. 送信が失敗しても**アプリは落ちない**
 * 3. `map_edited` は**必ず間引かれる**
 */

const ENDPOINT = "https://collector.example.test/events";

/** モジュール変数（間引きの状態）を毎回まっさらにするため、都度読み直す。 */
async function loadTrack() {
  vi.resetModules();
  return import("@/features/telemetry/track");
}

function stubSendBeacon(impl: (url: string, blob: Blob) => boolean) {
  const fn = vi.fn(impl);
  Object.defineProperty(navigator, "sendBeacon", {
    value: fn,
    configurable: true,
    writable: true,
  });
  return fn;
}

function removeSendBeacon() {
  Object.defineProperty(navigator, "sendBeacon", {
    value: undefined,
    configurable: true,
    writable: true,
  });
}

async function readBlob(blob: Blob): Promise<unknown> {
  return JSON.parse(await blob.text());
}

beforeEach(() => {
  removeSendBeacon();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("送信先が未設定のとき", () => {
  it("本番では何も送らない", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", "");
    const beacon = stubSendBeacon(() => true);
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { track } = await loadTrack();
    track("app_started");
    track("map_opened", { nodeCount: 12 });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("開発時はコンソールに出すだけで、送信はしない", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", "");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { track } = await loadTrack();
    track("app_started");

    expect(debug).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("送信先が設定されているとき", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
  });

  it("sendBeacon で1件送る", async () => {
    const beacon = stubSendBeacon(() => true);

    const { track } = await loadTrack();
    track("png_exported", { nodeCount: 40, scaled: true });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [url, blob] = beacon.mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(await readBlob(blob)).toEqual({
      name: "png_exported",
      properties: { nodeCount: 40, scaled: true },
      at: expect.any(Number),
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("送るのは渡したペイロードだけで、余計な情報を足さない", async () => {
    const beacon = stubSendBeacon(() => true);

    const { track } = await loadTrack();
    track("sync_failed", { reason: "conflict" });

    const envelope = (await readBlob(beacon.mock.calls[0][1])) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(["at", "name", "properties"]);
    expect(envelope.properties).toEqual({ reason: "conflict" });
  });

  it("sendBeacon が無ければ fetch にフォールバックする", async () => {
    const { track } = await loadTrack();
    track("map_created");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("omit");
    expect(JSON.parse(init.body)).toMatchObject({ name: "map_created", properties: {} });
  });

  it("sendBeacon が false を返したら fetch で送り直す", async () => {
    stubSendBeacon(() => false);

    const { track } = await loadTrack();
    track("map_created");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("送信が失敗しても", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
  });

  it("fetch が reject してもアプリは落ちない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const { track } = await loadTrack();
    expect(() => track("app_started")).not.toThrow();
  });

  it("fetch の reject を握りつぶす（unhandled rejection を残さない）", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const { track } = await loadTrack();
    track("app_started");
    // 未処理の reject が報告されるのは次のマクロタスク以降。
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
  });

  it("fetch がその場で投げてもアプリは落ちない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch is not available");
      }),
    );

    const { track } = await loadTrack();
    expect(() => track("app_started")).not.toThrow();
  });

  it("sendBeacon が投げても fetch で送り直し、落ちない", async () => {
    stubSendBeacon(() => {
      throw new Error("beacon blocked");
    });

    const { track } = await loadTrack();
    expect(() => track("app_started")).not.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("map_edited の間引き（§31: 打鍵ごとに出さない）", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T00:00:00Z"));
  });

  it("連続で呼んでも送るのは1件だけ", async () => {
    const beacon = stubSendBeacon(() => true);
    const { trackMapEdited } = await loadTrack();

    for (let i = 0; i < 200; i += 1) {
      vi.advanceTimersByTime(50);
      trackMapEdited();
    }

    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("間隔を越えたら次の1件を送る", async () => {
    const beacon = stubSendBeacon(() => true);
    const { trackMapEdited, MAP_EDITED_THROTTLE_MS } = await loadTrack();

    trackMapEdited();
    vi.advanceTimersByTime(MAP_EDITED_THROTTLE_MS - 1);
    trackMapEdited();
    expect(beacon).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    trackMapEdited();
    expect(beacon).toHaveBeenCalledTimes(2);
  });

  it("最初の1件はすぐ送る", async () => {
    const beacon = stubSendBeacon(() => true);
    const { trackMapEdited } = await loadTrack();

    trackMapEdited();

    expect(beacon).toHaveBeenCalledTimes(1);
    expect(await readBlob(beacon.mock.calls[0][1])).toMatchObject({ name: "map_edited" });
  });
});
