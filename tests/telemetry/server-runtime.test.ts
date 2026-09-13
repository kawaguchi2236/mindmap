// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "@/features/telemetry/errors";
import { track } from "@/features/telemetry/track";

/**
 * サーバ（Node / Cloudflare Workers）から呼んでも壊れないことの検証。
 *
 * `auth/config.ts` はサーバ専用で、そこから `track()` を呼んでいる。
 * このファイルだけ `environment: node` で走らせ、**window も document も
 * sendBeacon も無い状態**で例外が出ないことを固定する。
 */

const ENDPOINT = "https://collector.example.test/events";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
  vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", ENDPOINT);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("サーバ実行時", () => {
  it("window も document も無い", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("sendBeacon が無くても track は落ちず、fetch で送る", () => {
    expect(globalThis.navigator?.sendBeacon).toBeUndefined();
    expect(() => track("login_completed", { method: "google" })).not.toThrow();

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(init.body)).toMatchObject({
      name: "login_completed",
      properties: { method: "google" },
    });
  });

  it("送信先が未設定なら何もしない", () => {
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", "");
    expect(() => track("login_completed", { method: "email" })).not.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("fetch が無い実行環境でも落ちない", () => {
    vi.stubGlobal("fetch", undefined);
    expect(() => track("app_started")).not.toThrow();
    expect(() => reportError(new Error("boom"), "auth")).not.toThrow();
  });

  it("送信が失敗しても落ちず、unhandled rejection も残さない", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    expect(() => track("login_completed", { method: "email" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off("unhandledRejection", onUnhandled);

    expect(unhandled).toEqual([]);
  });
});
