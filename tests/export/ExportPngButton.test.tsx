import { ReactFlowProvider } from "@xyflow/react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExportPngButton } from "@/features/export";
import { exportMapToPng, type ExportResult } from "@/features/export/exportPng";

/**
 * ボタンの状態遷移だけを見るテスト。
 *
 * 画像化そのものは exportMapToPng をモックして切り離している。
 * **クリックしてブラウザがファイルを保存するところは jsdom では一切動かない。**
 */
vi.mock("@/features/export/exportPng", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/export/exportPng")>();
  return { ...actual, exportMapToPng: vi.fn() };
});

const exportMock = vi.mocked(exportMapToPng);

/**
 * 本番ではボタンは `<ReactFlow>` の中（= `.react-flow` の子孫）に置かれる。
 * `useReactFlow()` を使うので `ReactFlowProvider` が必須。
 */
function renderButton(title: string | null = "計画"): void {
  render(
    <ReactFlowProvider>
      <div className="react-flow">
        <div className="react-flow__viewport" />
        <div className="mindmap-canvas__actions">
          <ExportPngButton title={title} />
        </div>
      </div>
    </ReactFlowProvider>,
  );
}

beforeEach(() => {
  exportMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExportPngButton", () => {
  it("読み上げ可能な名前を持つ", () => {
    exportMock.mockResolvedValue({ ok: true, fileName: "計画.png", scale: 1, width: 1, height: 1 });
    renderButton();
    expect(screen.getByRole("button", { name: "マップを PNG で書き出す" })).toBeInTheDocument();
  });

  it("クリックすると自分のキャンバスのビューポートとタイトルを渡す", async () => {
    exportMock.mockResolvedValue({ ok: true, fileName: "計画.png", scale: 1, width: 1, height: 1 });
    const user = userEvent.setup();
    renderButton("計画");

    await user.click(screen.getByRole("button", { name: "マップを PNG で書き出す" }));

    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(1));
    const params = exportMock.mock.calls[0][0];
    expect(params.title).toBe("計画");
    expect(params.viewport).toBe(document.querySelector(".react-flow__viewport"));
  });

  it("処理中はボタンを押せなくする", async () => {
    let resolve: ((value: ExportResult) => void) | undefined;
    exportMock.mockImplementation(
      () =>
        new Promise<ExportResult>((r) => {
          resolve = r;
        }),
    );
    const user = userEvent.setup();
    renderButton();

    const button = screen.getByRole("button", { name: "マップを PNG で書き出す" });
    await user.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("aria-busy", "true");

    resolve?.({ ok: false, message: "失敗しました。" });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("失敗したらユーザーに伝え、同じボタンで再試行できる", async () => {
    exportMock.mockResolvedValueOnce({ ok: false, message: "PNG の書き出しに失敗しました。" });
    const user = userEvent.setup();
    renderButton();

    const button = screen.getByRole("button", { name: "マップを PNG で書き出す" });
    await user.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("PNG の書き出しに失敗しました。");

    // 押し直せるし、押し直せば本当にもう一度呼ばれる。
    exportMock.mockResolvedValueOnce({
      ok: true,
      fileName: "計画.png",
      scale: 1,
      width: 1,
      height: 1,
    });
    await user.click(button);
    await waitFor(() => expect(exportMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("上限で縮小されたときは黙らず、縮小率を伝える", async () => {
    exportMock.mockResolvedValue({
      ok: true,
      fileName: "計画.png",
      scale: 0.42,
      width: 100,
      height: 100,
    });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "マップを PNG で書き出す" }));

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("42%");
  });

  it("等倍で書き出せたときは余計なメッセージを出さない", async () => {
    exportMock.mockResolvedValue({ ok: true, fileName: "計画.png", scale: 1, width: 1, height: 1 });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "マップを PNG で書き出す" }));

    await waitFor(() => expect(exportMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
