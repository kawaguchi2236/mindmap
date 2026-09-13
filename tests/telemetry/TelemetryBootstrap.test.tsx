import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const ENDPOINT = "https://collector.example.test/events";

async function loadBootstrap() {
  vi.resetModules();
  return import("@/features/telemetry/TelemetryBootstrap");
}

function bodies(): string {
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
  vi.stubEnv("NEXT_PUBLIC_ANALYTICS_ENDPOINT", ENDPOINT);
  vi.stubEnv("NEXT_PUBLIC_ERROR_ENDPOINT", ENDPOINT);
});

afterEach(() => {
  window.removeEventListener("error", suppressUncaught);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TelemetryBootstrap", () => {
  it("何も描画しない（キャンバスや画面に影響しない）", async () => {
    const { TelemetryBootstrap } = await loadBootstrap();
    const { container } = render(<TelemetryBootstrap />);

    expect(container).toBeEmptyDOMElement();
  });

  it("app_started を1回だけ送る", async () => {
    const { TelemetryBootstrap } = await loadBootstrap();
    const first = render(<TelemetryBootstrap />);
    first.unmount();
    render(<TelemetryBootstrap />);

    expect(bodies().match(/app_started/g)).toHaveLength(1);
  });

  it("マウント中に拾い損ねた例外を報告し、アンマウントで止める", async () => {
    const { TelemetryBootstrap } = await loadBootstrap();
    const view = render(<TelemetryBootstrap />);

    dispatchWindowError(new TypeError("boom"));
    expect(bodies()).toContain("TypeError");

    view.unmount();
    dispatchWindowError(new RangeError("later"));
    expect(bodies()).not.toContain("RangeError");
  });
});
