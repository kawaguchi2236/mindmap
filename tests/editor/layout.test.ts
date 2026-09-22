import { describe, expect, it } from "vitest";
import {
  columnStep,
  depthToX,
  findNeighbor,
  layoutTree,
  placeNewChild,
  restackSiblings,
  subtreeBounds,
  V_GAP,
} from "@/features/editor/layout";
import { getVisibleNodes } from "@/features/editor/tree";
import { buildTree, findByText, heightOf, rootId } from "./helpers";

const SPEC = {
  text: "root",
  children: [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, { text: "B" }],
};

describe("layout", () => {
  it("深さごとに x が決まり、子は親の右に並ぶ", () => {
    const nodes = layoutTree(buildTree(SPEC));
    expect(findByText(nodes, "root").x).toBe(0);
    expect(findByText(nodes, "A").x).toBe(depthToX(1));
    expect(findByText(nodes, "B").x).toBe(depthToX(1));
    expect(findByText(nodes, "A1").x).toBe(depthToX(2));
  });

  it("兄弟は重ならず、親は子の中央に来る", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const a1 = findByText(nodes, "A1");
    const a2 = findByText(nodes, "A2");
    expect(a2.y - a1.y).toBe(heightOf(nodes, a1) + V_GAP);
    // 親は「子群の中央」に来る。階層で高さが違うので上端ではなく中心で比べる。
    const a = findByText(nodes, "A");
    const subtreeCenter = (a1.y + a2.y + heightOf(nodes, a2)) / 2;
    expect(a.y + heightOf(nodes, a) / 2).toBe(subtreeCenter);
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
    expect(findByText(nodes, "B").y - findByText(nodes, "A").y).toBe(
      heightOf(nodes, findByText(nodes, "A")) + V_GAP,
    );
  });

  it("subtreeBounds は表示されている範囲だけを測る", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const bounds = subtreeBounds(nodes, findByText(nodes, "A").id);
    expect(bounds.top).toBe(findByText(nodes, "A1").y);
    expect(bounds.bottom).toBe(
      findByText(nodes, "A2").y + heightOf(nodes, findByText(nodes, "A2")),
    );
  });

  it("restackSiblings は部分木ごと動かして重なりを解消する", () => {
    const laid = layoutTree(buildTree(SPEC));
    // B を A の部分木に重なる位置へ動かした状態から積み直す
    const overlapped = laid.map((node) => (node.text === "B" ? { ...node, y: 0 } : node));
    const nodes = restackSiblings(overlapped, rootId(overlapped));
    const aBounds = subtreeBounds(nodes, findByText(nodes, "A").id);
    expect(findByText(nodes, "B").y).toBe(aBounds.bottom + V_GAP);
    // A の部分木の内部の相対位置は保たれる
    expect(findByText(nodes, "A2").y - findByText(nodes, "A1").y).toBe(
      heightOf(nodes, findByText(nodes, "A1")) + V_GAP,
    );
  });

  it("restackSiblings は子群を親の中心に対して上下対称に積む", () => {
    // Enter / Tab の経路（reflow → restackAncestors → restackSiblings）は
    // 一括整列を通らない。ここが上端固定だと、子は親の下へ伸びるばかりで
    // 親が子群の先頭に張り付く。
    const source = buildTree({
      text: "root",
      children: [{ text: "A" }, { text: "B" }, { text: "C" }],
    });
    // placeNewChild が置いたまま（親の高さから下へ積んだだけ）の状態を作る。
    const root = findByText(source, "root");
    let cursor = root.y;
    const stacked = source.map((node) => {
      if (node.parentId === null) return node;
      const y = cursor;
      cursor += heightOf(source, node) + V_GAP;
      return { ...node, x: depthToX(1), y };
    });

    const nodes = restackSiblings(stacked, rootId(stacked));
    const first = findByText(nodes, "A");
    const last = findByText(nodes, "C");
    const after = findByText(nodes, "root");
    const childrenCenter = (first.y + last.y + heightOf(nodes, last)) / 2;
    expect(after.y + heightOf(nodes, after) / 2).toBe(childrenCenter);
    // 上下に均等に開く：先頭の子は親より上へ出る。
    expect(first.y).toBeLessThan(after.y);
    // 親は動かさない（打っている最中にルートが飛ばない）。
    expect(after.y).toBe(root.y);
  });

  it("placeNewChild は既存の兄弟の下に置く", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const root = findByText(nodes, "root");
    const placed = placeNewChild(nodes, root.id);
    expect(placed.x).toBe(root.x + columnStep(0));
    expect(placed.y).toBe(
      findByText(nodes, "B").y + heightOf(nodes, findByText(nodes, "B")) + V_GAP,
    );

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
