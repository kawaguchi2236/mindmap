import { render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { createMapDocument } from "@/lib/model/factory";

/**
 * ReactFlow 本体だけを差し替えて、渡している props を覗く。
 *
 * 守りたいのは「非 controlled（defaultNodes）＋ 命令的な setNodes」の併用に
 * 戻らないこと。この組み合わせだと React Flow が実測した measured が毎回
 * 捨てられ、全ノードが visibility: hidden になって画面から消える。
 * onNodesChange は採寸結果を受け取る唯一の口なので、外れたら検知したい。
 */
let capturedProps: Record<string, unknown> = {};

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    ReactFlow: (props: Record<string, unknown>) => {
      capturedProps = props;
      return null;
    },
  };
});

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  capturedProps = {};
  const doc = createMapDocument({ title: "テスト" }, "ルート");
  render(<MindMapEditor document={doc} onChange={vi.fn()} />);
});

describe("MindMapCanvas が ReactFlow に渡す props", () => {
  it("controlled で使う（nodes / edges を渡す）", () => {
    expect(Array.isArray(capturedProps.nodes)).toBe(true);
    expect(Array.isArray(capturedProps.edges)).toBe(true);
  });

  it("採寸結果を受け取るため onNodesChange / onEdgesChange を必ず繋ぐ", () => {
    expect(typeof capturedProps.onNodesChange).toBe("function");
    expect(typeof capturedProps.onEdgesChange).toBe("function");
  });

  it("defaultNodes / defaultEdges とは併用しない", () => {
    expect(capturedProps.defaultNodes).toBeUndefined();
    expect(capturedProps.defaultEdges).toBeUndefined();
  });

  it("React Flow 組み込みのキー操作は無効化しておく（useKeyboard と衝突させない）", () => {
    expect(capturedProps.deleteKeyCode).toBeNull();
    expect(capturedProps.selectionKeyCode).toBeNull();
    expect(capturedProps.multiSelectionKeyCode).toBeNull();
    expect(capturedProps.disableKeyboardA11y).toBe(true);
  });
});
