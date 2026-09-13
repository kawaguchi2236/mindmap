import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { createMapDocument } from "@/lib/model/factory";

/**
 * 統合入口が落ちずに描画できることだけを見る煙テスト。
 * 操作の検証は純粋ロジック側（reducer / history）で行う。
 */
describe("MindMapEditor", () => {
  it("ドキュメントのノードを描画する", () => {
    const doc = createMapDocument({ title: "テスト" }, "ルート");
    render(<MindMapEditor document={doc} onChange={vi.fn()} />);
    expect(screen.getByText("ルート")).toBeInTheDocument();
  });

  it("描画しただけでは onChange を呼ばない（保存を誘発しない）", () => {
    const onChange = vi.fn();
    const doc = createMapDocument({ title: "テスト" }, "ルート");
    render(<MindMapEditor document={doc} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });
});
