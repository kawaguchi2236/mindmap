import { ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportPngButton } from "@/features/export";
import { exportMapToPng } from "@/features/export/exportPng";
import { useMapList } from "@/features/maps/useMapList";
import { useSyncRunner } from "@/features/sync/useSyncRunner";
import { resetRepositoryForTests } from "@/lib/db";
import { FakeLocalStore, FakeRemoteClient, makeMap, makeRecord } from "../sync/helpers";

/**
 * **イベントが実際に発火する経路があること**の検証。
 *
 * telemetry をモックせず、送信先を設定したうえで `fetch` に届く中身を見る。
 * 「呼ばれるはず」ではなく、呼び出し元から送信までが繋がっていることを固定する。
 */

vi.mock("@/features/export/exportPng", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/export/exportPng")>();
  return { ...actual, exportMapToPng: vi.fn() };
});

const exportMock = vi.mocked(exportMapToPng);
const ENDPOINT = "https://collector.example.test/events";

/** 送信された計測イベント（エラー報告は除く）。 */
function sentEvents(): { name: string; properties: Record<string, unknown> }[] {
  const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>)
    .filter((body): body is { name: string; properties: Record<string, unknown> } =>
      Object.hasOwn(body, "name"),
    );
}

function eventNames(): string[] {
  return sentEvents().map((event) => event.name);
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
  exportMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// map_created
// ---------------------------------------------------------------------------

describe("map_created（useMapList.create）", () => {
  beforeEach(async () => {
    await resetRepositoryForTests();
    globalThis.indexedDB = new IDBFactory();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("マップを作ると 1 件だけ発火する", async () => {
    const { result } = renderHook(() => useMapList());
    await waitFor(() => expect(result.current.maps).not.toBeNull());

    await act(async () => {
      await result.current.create();
    });

    expect(eventNames()).toEqual(["map_created"]);
    expect(sentEvents()[0].properties).toEqual({});
  });

  it("一覧を読むだけでは発火しない", async () => {
    const { result } = renderHook(() => useMapList());
    await waitFor(() => expect(result.current.maps).not.toBeNull());

    expect(eventNames()).toEqual([]);
  });

  it("作成に失敗したら発火しない", async () => {
    const { result } = renderHook(() => useMapList());
    await waitFor(() => expect(result.current.maps).not.toBeNull());

    // IndexedDB を壊して createMap を失敗させる。
    globalThis.indexedDB = undefined as unknown as IDBFactory;
    await resetRepositoryForTests();
    await act(async () => {
      await result.current.create();
    });

    expect(eventNames()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// png_exported
// ---------------------------------------------------------------------------

/**
 * 本番と同じく `<ReactFlow>` の中にボタンを置く。
 * `getNodes()` の件数を実際に動かしたいので、ノードは props で渡す。
 */
function renderExportButton(nodeCount: number): void {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    position: { x: i * 10, y: 0 },
    data: { label: `n${i}` },
  }));

  render(
    <ReactFlowProvider>
      <ReactFlow nodes={nodes} edges={[]}>
        <div className="mindmap-canvas__actions">
          <ExportPngButton title="計画" />
        </div>
      </ReactFlow>
    </ReactFlowProvider>,
  );
}

describe("png_exported（ExportPngButton）", () => {
  it("書き出しに成功するとノード数と縮小の有無を送る", async () => {
    exportMock.mockResolvedValue({ ok: true, fileName: "計画.png", scale: 1, width: 1, height: 1 });
    const user = userEvent.setup();
    renderExportButton(3);

    await user.click(document.querySelector("button")!);
    await waitFor(() => expect(eventNames()).toContain("png_exported"));

    expect(sentEvents()[0].properties).toEqual({ nodeCount: 3, scaled: false });
  });

  it("縮小したときは scaled: true になる", async () => {
    exportMock.mockResolvedValue({
      ok: true,
      fileName: "計画.png",
      scale: 0.5,
      width: 1,
      height: 1,
    });
    const user = userEvent.setup();
    renderExportButton(2);

    await user.click(document.querySelector("button")!);
    await waitFor(() => expect(eventNames()).toContain("png_exported"));

    expect(sentEvents()[0].properties).toEqual({ nodeCount: 2, scaled: true });
  });

  it("書き出しに失敗したら発火しない", async () => {
    exportMock.mockResolvedValue({ ok: false, message: "書き出せませんでした" });
    const user = userEvent.setup();
    renderExportButton(3);

    await user.click(document.querySelector("button")!);
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

    expect(eventNames()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// sync_completed / sync_failed
// ---------------------------------------------------------------------------

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

describe("sync_completed / sync_failed（useSyncRunner）", () => {
  it("同期できたら動いたマップ数を送る（何もしなかったマップは数えない）", async () => {
    // m1 は未送信なので push される。m2 は両者同じなので skipped になる。
    const local = new FakeLocalStore([
      makeRecord({ dirty: true }),
      makeRecord({ map: { id: "m2" }, dirty: false }),
    ]);
    const remote = new FakeRemoteClient([makeMap({ id: "m2" })]);

    renderHook(() => useSyncRunner({ userId: "u1", local, remote }));
    await settle();

    await waitFor(() => expect(eventNames()).toContain("sync_completed"));
    const completed = sentEvents().find((event) => event.name === "sync_completed");
    expect(completed?.properties).toEqual({ mapCount: 1 });
    expect(eventNames()).not.toContain("sync_failed");
  });

  it("失敗したら固定語彙の理由を送る（サーバの文言は送らない）", async () => {
    const local = new FakeLocalStore([makeRecord({ dirty: true })]);
    const remote = new FakeRemoteClient();
    remote.alwaysFail.set("m1", {
      ok: false,
      kind: "serverError",
      message: "テストマップの保存に失敗",
    });

    renderHook(() => useSyncRunner({ userId: "u1", local, remote }));
    await settle();

    await waitFor(() => expect(eventNames()).toContain("sync_failed"));
    const failed = sentEvents().find((event) => event.name === "sync_failed");
    expect(failed?.properties).toEqual({ reason: "server" });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const serialized = fetchMock.mock.calls.map(([, init]) => String(init.body)).join("\n");
    expect(serialized).not.toContain("テストマップ");
  });

  it("一覧取得で中断したときは自由文字列を送らず unknown にする", async () => {
    const local = new FakeLocalStore([makeRecord({ dirty: true })]);
    const remote = new FakeRemoteClient();
    remote.alwaysFail.set("*", { ok: false, kind: "serverError", message: "一覧が壊れています" });

    renderHook(() => useSyncRunner({ userId: "u1", local, remote }));
    await settle();

    await waitFor(() => expect(eventNames()).toContain("sync_failed"));
    const failed = sentEvents().find((event) => event.name === "sync_failed");
    expect(failed?.properties).toEqual({ reason: "unknown" });
  });

  it("ゲストでは 1 件も発火しない", async () => {
    const local = new FakeLocalStore([makeRecord({ dirty: true })]);
    const remote = new FakeRemoteClient();

    renderHook(() => useSyncRunner({ userId: null, local, remote }));
    await settle();

    expect(eventNames()).toEqual([]);
  });
});
