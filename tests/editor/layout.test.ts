import { describe, expect, it } from "vitest";
import {
  findNeighbor,
  H_GAP,
  layoutTree,
  NODE_HEIGHT,
  NODE_WIDTH,
  placeNewChild,
  restackSiblings,
  subtreeBounds,
  V_GAP,
} from "@/features/editor/layout";
import { getVisibleNodes } from "@/features/editor/tree";
import { buildTree, findByText, rootId } from "./helpers";

const SPEC = {
  text: "root",
  children: [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, { text: "B" }],
};

describe("layout", () => {
  it("深さごとに x が決まり、子は親の右に並ぶ", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const step = NODE_WIDTH + H_GAP;
    expect(findByText(nodes, "root").x).toBe(0);
    expect(findByText(nodes, "A").x).toBe(step);
    expect(findByText(nodes, "B").x).toBe(step);
    expect(findByText(nodes, "A1").x).toBe(step * 2);
  });

  it("兄弟は重ならず、親は子の中央に来る", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const a1 = findByText(nodes, "A1");
    const a2 = findByText(nodes, "A2");
    expect(a2.y - a1.y).toBe(NODE_HEIGHT + V_GAP);
    expect(findByText(nodes, "A").y).toBe((a1.y + a2.y) / 2);
    // A の部分木（2ノード分）と B が縦に重ならない
    expect(findByText(nodes, "B").y).toBeGreaterThan(a2.y);
  });

  it("collapsed なノードは葉として扱われ、子孫の座標は動かさない", () => {
    const source = buildTree({
      ...SPEC,
      children: [{ ...SPEC.children[0], collapsed: true }, SPEC.children[1]],
    });
    const marked = source.map((node) => (node.text === "A1" ? { ...node, x: 999, y: 999 } : node));
    const nodes = layoutTree(marked);
    expect(findByText(nodes, "A1").x).toBe(999);
    expect(findByText(nodes, "B").y - findByText(nodes, "A").y).toBe(NODE_HEIGHT + V_GAP);
  });

  it("subtreeBounds は表示されている範囲だけを測る", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const bounds = subtreeBounds(nodes, findByText(nodes, "A").id);
    expect(bounds.top).toBe(findByText(nodes, "A1").y);
    expect(bounds.bottom).toBe(findByText(nodes, "A2").y + NODE_HEIGHT);
  });

  it("restackSiblings は部分木ごと動かして重なりを解消する", () => {
    const laid = layoutTree(buildTree(SPEC));
    // B を A の部分木に重なる位置へ動かした状態から積み直す
    const overlapped = laid.map((node) => (node.text === "B" ? { ...node, y: 0 } : node));
    const nodes = restackSiblings(overlapped, rootId(overlapped));
    const aBounds = subtreeBounds(nodes, findByText(nodes, "A").id);
    expect(findByText(nodes, "B").y).toBe(aBounds.bottom + V_GAP);
    // A の部分木の内部の相対位置は保たれる
    expect(findByText(nodes, "A2").y - findByText(nodes, "A1").y).toBe(NODE_HEIGHT + V_GAP);
  });

  it("placeNewChild は既存の兄弟の下に置く", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const root = findByText(nodes, "root");
    const placed = placeNewChild(nodes, root.id);
    expect(placed.x).toBe(root.x + NODE_WIDTH + H_GAP);
    expect(placed.y).toBe(findByText(nodes, "B").y + NODE_HEIGHT + V_GAP);

    // 子がいない場合は親と同じ高さ
    const leaf = findByText(nodes, "B");
    expect(placeNewChild(nodes, leaf.id).y).toBe(leaf.y);
  });

  it("矢印キーの移動先は方向どおりに決まる", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const visible = getVisibleNodes(nodes);
    const root = findByText(nodes, "root");
    const a = findByText(nodes, "A");

    expect(findNeighbor(visible, root.id, "right")).toBe(a.id);
    expect(findNeighbor(visible, a.id, "left")).toBe(root.id);
    expect(findNeighbor(visible, a.id, "down")).toBe(findByText(nodes, "B").id);
    expect(findNeighbor(visible, findByText(nodes, "A2").id, "up")).toBe(
      findByText(nodes, "A1").id,
    );
    expect(findNeighbor(visible, root.id, "left")).toBeNull();
  });
});
