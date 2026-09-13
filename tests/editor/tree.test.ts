import { describe, expect, it } from "vitest";
import {
  cloneSubtree,
  getChildren,
  getDepth,
  getDescendantIds,
  getRoot,
  getSiblings,
  getSubtreeIds,
  getVisibleNodes,
  isDescendantOf,
  nextOrder,
  normalizeOrders,
  removeSubtree,
  reparent,
} from "@/features/editor/tree";
import { buildTree, childTexts, findByText, MAP_ID, rootId } from "./helpers";

const SPEC = {
  text: "root",
  children: [
    { text: "A", children: [{ text: "A1" }, { text: "A2" }] },
    { text: "B", children: [{ text: "B1" }] },
  ],
};

describe("tree", () => {
  it("ルートと子を order 順に取得できる", () => {
    const nodes = buildTree(SPEC);
    expect(getRoot(nodes)?.text).toBe("root");
    expect(childTexts(nodes, rootId(nodes))).toEqual(["A", "B"]);
  });

  it("order が逆でも昇順に並べ直す", () => {
    const nodes = buildTree(SPEC).map((node) =>
      node.text === "A" ? { ...node, order: 10 } : node,
    );
    expect(childTexts(nodes, rootId(nodes))).toEqual(["B", "A"]);
  });

  it("子孫の列挙は自分を含まない", () => {
    const nodes = buildTree(SPEC);
    const a = findByText(nodes, "A");
    expect(getSubtreeIds(nodes, a.id)).toHaveLength(3);
    expect(getDescendantIds(nodes, a.id)).toHaveLength(2);
    expect(isDescendantOf(nodes, findByText(nodes, "A1").id, a.id)).toBe(true);
    expect(isDescendantOf(nodes, findByText(nodes, "B1").id, a.id)).toBe(false);
  });

  it("深さと兄弟を取得できる", () => {
    const nodes = buildTree(SPEC);
    expect(getDepth(nodes, rootId(nodes))).toBe(0);
    expect(getDepth(nodes, findByText(nodes, "A1").id)).toBe(2);
    expect(getSiblings(nodes, findByText(nodes, "A1").id).map((n) => n.text)).toEqual(["A1", "A2"]);
  });

  it("collapsed なノードの子孫は可視ノードに含まれない", () => {
    const nodes = buildTree({
      ...SPEC,
      children: [{ ...SPEC.children[0], collapsed: true }, SPEC.children[1]],
    });
    expect(getVisibleNodes(nodes).map((node) => node.text)).toEqual(["root", "A", "B", "B1"]);
  });

  it("部分木の削除で子孫も消える", () => {
    const nodes = buildTree(SPEC);
    const next = removeSubtree(nodes, findByText(nodes, "A").id);
    expect(next.map((node) => node.text).sort()).toEqual(["B", "B1", "root"]);
  });

  it("ルートは削除できない", () => {
    const nodes = buildTree(SPEC);
    expect(removeSubtree(nodes, rootId(nodes))).toBe(nodes);
  });

  it("自分の子孫を親にする付け替えは拒否する", () => {
    const nodes = buildTree(SPEC);
    const a = findByText(nodes, "A");
    const a1 = findByText(nodes, "A1");
    expect(reparent(nodes, a.id, a1.id, 0)).toBe(nodes);
    const moved = reparent(nodes, a1.id, findByText(nodes, "B").id, 5);
    expect(childTexts(moved, findByText(moved, "B").id)).toEqual(["B1", "A1"]);
  });

  it("normalizeOrders は 0 から連番に振り直す", () => {
    const nodes = buildTree(SPEC).map((node) =>
      node.text === "B" ? { ...node, order: 0.5 } : node,
    );
    const normalized = normalizeOrders(nodes, rootId(nodes));
    expect(getChildren(normalized, rootId(normalized)).map((n) => [n.text, n.order])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });

  it("nextOrder は末尾の次を返す", () => {
    const nodes = buildTree(SPEC);
    expect(nextOrder(nodes, rootId(nodes))).toBe(2);
    expect(nextOrder(nodes, findByText(nodes, "B1").id)).toBe(0);
  });

  it("cloneSubtree は ID を振り直し、親子関係を保つ", () => {
    const nodes = buildTree(SPEC);
    const a = findByText(nodes, "A");
    const clones = cloneSubtree(nodes, a.id, { parentId: rootId(nodes), mapId: MAP_ID, order: 9 });

    const originalIds = new Set(nodes.map((node) => node.id));
    expect(clones).toHaveLength(3);
    expect(clones.every((clone) => !originalIds.has(clone.id))).toBe(true);
    expect(clones[0].parentId).toBe(rootId(nodes));
    expect(clones[0].order).toBe(9);
    // 複製の子は複製されたルートを指す（元の A ではない）
    expect(clones.slice(1).every((clone) => clone.parentId === clones[0].id)).toBe(true);
    expect(clones.map((clone) => clone.text)).toEqual(["A", "A1", "A2"]);
    // 元の配列は変わらない
    expect(nodes).toHaveLength(6);
  });
});
