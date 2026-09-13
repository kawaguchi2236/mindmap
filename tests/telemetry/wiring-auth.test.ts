import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `login_completed` の配線の検証。
 *
 * next-auth 本体は vitest の解決では読み込めない（`next/server` を拡張子なしで
 * import しており、`vitest.config.mts` を変えないと通らない。設定ファイルは
 * 別担当の所有なので触らない）。そこで**周辺だけをモックし、config.ts 自身は
 * 本物を読む**。`buildConfig()` が返すのは Auth.js へ実際に渡る設定そのものなので、
 * これで「イベントが登録されていて、呼ぶと送信まで届く」ことを確認できる。
 */

vi.mock("next-auth", () => ({ default: () => ({}) }));
vi.mock("next-auth/providers/google", () => ({ default: () => ({ id: "google" }) }));
vi.mock("next-auth/providers/resend", () => ({ default: () => ({ id: "resend" }) }));
vi.mock("@auth/neon-adapter", () => ({ default: () => ({}) }));
vi.mock("@/lib/server/db", () => ({ createPool: () => ({}) }));

const { buildConfig } = await import("@/features/auth/config");

const ENDPOINT = "https://collector.example.test/events";

function sentBodies(): string {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map(([, init]) => String(init.body)).join("\n");
}

function sentEvents(): { name: string; properties: Record<string, unknown> }[] {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
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
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("login_completed（auth/config の events.signIn）", () => {
  it("Auth.js に渡す設定に signIn イベントが登録されている", () => {
    expect(typeof buildConfig().events?.signIn).toBe("function");
  });

  it("Google なら method: google を送る", () => {
    buildConfig().events?.signIn?.({
      user: { id: "u1" },
      account: { provider: "google", providerAccountId: "g1", type: "oidc" },
    });

    expect(sentEvents()).toEqual([
      { name: "login_completed", properties: { method: "google" }, at: expect.any(Number) },
    ]);
  });

  it("メールなら method: email を送り、メールアドレスも ID も送らない", () => {
    buildConfig().events?.signIn?.({
      user: { id: "9f1c2d3e", email: "kawaguchi2236@example.test" },
      account: { provider: "resend", providerAccountId: "r1", type: "email" },
    });

    expect(sentEvents()[0].properties).toEqual({ method: "email" });
    expect(sentBodies()).not.toContain("kawaguchi2236");
    expect(sentBodies()).not.toContain("9f1c2d3e");
  });

  it("送信先が未設定なら何も送らない", () => {
    vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", "");
    buildConfig().events?.signIn?.({
      user: { id: "u1" },
      account: { provider: "google", providerAccountId: "g1", type: "oidc" },
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
