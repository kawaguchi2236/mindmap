import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * エラー監視の検証（CLAUDE.md §29 / §30）。
 *
 * 固定したいのは「**利用者が書いた内容がペイロードに入らない**」こと。
 * ノード本文はエラーメッセージ経由で混ざりうるので、そこを潰してあることを見る。
 */

const ENDPOINT = "https://errors.example.test/report";
/** ノード本文に相当する、絶対に外へ出してはいけない文字列。 */
const SECRET = "利用者が書いたノード本文 kawaguchi2236@example.test";

async function loadErrors() {
  vi.resetModules();
  return import("@/features/telemetry/errors");
}

function lastBody(): Record<string, unknown> {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(init.body);
}

function serialized(): string {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map(([, init]) => String(init.body)).join("\n");
}

/**
 * jsdom は誰も拾わなかった window の error イベントを「テスト中の未捕捉エラー」として
 * 報告する。ここで投げているのは検証用の作り物なので、既定動作だけ止める
 * （preventDefault はリスナの実行を止めないので、検証対象の登録は普通に動く）。
 */
function suppressUncaught(event: Event) {
  event.preventDefault();
}

function dispatchWindowError(error: unknown) {
  window.dispatchEvent(new ErrorEvent("error", { error, cancelable: true }));
}

beforeEach(() => {
  window.addEventListener("error", suppressUncaught);
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
  vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", ENDPOINT);
});

afterEach(() => {
  window.removeEventListener("error", suppressUncaught);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reportError", () => {
  it("エラーメッセージ本文を送らない", async () => {
    const error = new Error(SECRET);
    error.stack = `Error: ${SECRET}\n    at save (/src/features/editor/reducer.ts:10:3)`;

    const { reportError } = await loadErrors();
    reportError(error, "editor");

    expect(serialized()).not.toContain("利用者が書いた");
    expect(serialized()).not.toContain("kawaguchi2236");
    const body = lastBody();
    expect(Object.keys(body).sort()).toEqual(["at", "frames", "name", "where"]);
    expect(body).toMatchObject({ name: "Error", where: "editor" });
    expect(body.frames).toEqual(["at save (/src/features/editor/reducer.ts:10:3)"]);
  });

  it("Safari 形式のスタックでもフレーム行だけを残す", async () => {
    const error = new Error(SECRET);
    error.stack = `save@/src/features/editor/reducer.ts:10:3\nrun@/src/app/page.tsx:4:1`;

    const { reportError } = await loadErrors();
    reportError(error, "editor");

    expect(serialized()).not.toContain("利用者が書いた");
    expect(lastBody().frames).toEqual([
      "save@/src/features/editor/reducer.ts:10:3",
      "run@/src/app/page.tsx:4:1",
    ]);
  });

  it("Error 以外が投げられたら中身を一切見ない", async () => {
    const { reportError } = await loadErrors();
    reportError({ nodeText: SECRET }, "sync");
    reportError(SECRET, "sync");

    expect(serialized()).not.toContain("利用者が書いた");
    expect(lastBody()).toMatchObject({ name: "NonError", where: "sync", frames: [] });
  });

  it("エラー種別の名前は残す（診断に要る）", async () => {
    const { reportError } = await loadErrors();
    reportError(new TypeError("x is not a function"), "persistence");

    expect(lastBody()).toMatchObject({ name: "TypeError", where: "persistence" });
  });

  it("フレームは10件までに切り詰める", async () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      ...Array.from({ length: 30 }, (_, i) => `    at f${i} (/a.ts:${i}:1)`),
    ].join("\n");

    const { reportError } = await loadErrors();
    reportError(error);

    expect((lastBody().frames as string[]).length).toBe(10);
  });

  it("送信先が未設定なら本番では何も送らない", async () => {
    vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", "");
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});

    const { reportError } = await loadErrors();
    reportError(new Error("boom"));

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });

  it("送信が失敗してもアプリは落ちない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const { reportError } = await loadErrors();
    expect(() => reportError(new Error("boom"))).not.toThrow();
    await Promise.resolve();
  });
});

describe("installGlobalErrorHandlers", () => {
  it("拾い損ねた例外を報告する", async () => {
    const { installGlobalErrorHandlers } = await loadErrors();
    const uninstall = installGlobalErrorHandlers();

    const error = new Error(SECRET);
    error.stack = `Error: ${SECRET}\n    at boom (/src/app/page.tsx:1:1)`;
    dispatchWindowError(error);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(serialized()).not.toContain("利用者が書いた");
    expect(lastBody()).toMatchObject({ name: "Error", where: "global" });

    uninstall();
  });

  it("拾い損ねた reject を報告する", async () => {
    const { installGlobalErrorHandlers } = await loadErrors();
    const uninstall = installGlobalErrorHandlers();

    // jsdom は PromiseRejectionEvent を持たないので、同じ形の Event を投げる。
    const event = Object.assign(new Event("unhandledrejection"), {
      reason: new RangeError("out of range"),
    });
    window.dispatchEvent(event);

    expect(lastBody()).toMatchObject({ name: "RangeError", where: "unhandled-rejection" });

    uninstall();
  });

  it("解除したらもう報告しない", async () => {
    const { installGlobalErrorHandlers } = await loadErrors();
    installGlobalErrorHandlers()();

    dispatchWindowError(new Error("boom"));

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("二重に登録しても2件にならない", async () => {
    const { installGlobalErrorHandlers } = await loadErrors();
    installGlobalErrorHandlers();
    const uninstall = installGlobalErrorHandlers();

    dispatchWindowError(new Error("boom"));

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    uninstall();
  });
});
