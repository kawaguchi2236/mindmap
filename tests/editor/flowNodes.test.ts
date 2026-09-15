import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  mergePreservingMeasured,
  toFlowEdges,
  toFlowNodes,
  type MindMapFlowNode,
} from "@/features/editor/flowNodes";
import { nodeBox } from "@/features/editor/layout";
import { getVisibleNodes } from "@/features/editor/tree";
import { buildTree, findByText } from "./helpers";

const SPEC = {
  text: "root",
  children: [{ text: "A", children: [{ text: "A1" }] }, { text: "B" }],
};

/**
 * 同じモデル（= 同じノード ID）から、選択状態だけを変えた React Flow ノードを
 * 作る。ID が毎回変わると引き継ぎの検証にならないのでモデルは使い回す。
 */
function makeFlowNodes(): (selectedText?: string, editingText?: string) => MindMapFlowNode[] {
  const nodes = buildTree(SPEC);
  return (selectedText, editingText) =>
    toFlowNodes(getVisibleNodes(nodes), {
      selectedId: selectedText ? findByText(nodes, selectedText).id : null,
      editingId: editingText ? findByText(nodes, editingText).id : null,
      childCounts: new Map([[findByText(nodes, "root").id, 2]]),
      totalCount: nodes.length,
    });
}

/** 全ノードを採寸済みにする（React Flow から dimensions が返ってきた状態）。 */
function measureAll(nodes: MindMapFlowNode[]): MindMapFlowNode[] {
  return applyNodeChanges(
    nodes.map((node) => dimensionsChange(node.id)),
    nodes,
  );
}

/** React Flow が採寸を通知してくるのと同じ形の変更イベント。 */
function dimensionsChange(id: string, width = 180, height = 44): NodeChange<MindMapFlowNode> {
  return { id, type: "dimensions", dimensions: { width, height } };
}

describe("toFlowNodes / toFlowEdges", () => {
  it("選択・編集・折りたたみの状態を data に載せる", () => {
    const flow = makeFlowNodes()("A", "A");
    const a = flow.find((node) => node.data.text === "A");
    expect(a?.data).toMatchObject({ selected: true, editing: true, isRoot: false });
    // 編集中のノードはドラッグ不可（テキスト選択を優先する）
    expect(a?.draggable).toBe(false);
    expect(flow.find((node) => node.data.text === "B")?.draggable).toBe(true);
    expect(flow.find((node) => node.data.text === "root")?.data.isRoot).toBe(true);
  });

  it("全ノードに initialWidth / initialHeight を付ける（採寸前でも描画させる）", () => {
    const flow = makeFlowNodes()();
    expect(flow.length).toBeGreaterThan(0);
    for (const node of flow) {
      // 大きさは階層ごとの文字組みで決まる。data.depth と辻褄が合っていること。
      const box = nodeBox(node.data.text, node.data.depth);
      expect(node.initialWidth).toBe(box.width);
      expect(node.initialHeight).toBe(box.height);
    }
  });

  it("階層ごとに文字組みが変わる（ルートがもっとも大きい）", () => {
    const flow = makeFlowNodes()();
    const depthOf = (text: string) => flow.find((node) => node.data.text === text)?.data.depth;
    expect(depthOf("root")).toBe(0);
    expect(depthOf("A")).toBe(1);
    expect(depthOf("A1")).toBe(2);
  });

  it("ルートだけが `ROOT · N NODES` を持つ", () => {
    const flow = makeFlowNodes()();
    const root = flow.find((node) => node.data.isRoot);
    expect(root?.data.rootMeta).toBe(`ROOT · ${flow.length} NODES`);
    for (const node of flow) {
      if (!node.data.isRoot) expect(node.data.rootMeta).toBeNull();
    }
  });

  it("エッジは両端が表示されているものだけ描く", () => {
    const nodes = buildTree(SPEC).map((node) =>
      node.text === "A" ? { ...node, collapsed: true } : node,
    );
    const visible = getVisibleNodes(nodes);
    const edges = toFlowEdges(visible);
    // A1 は畳まれているのでエッジも出ない
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.target !== findByText(nodes, "A1").id)).toBe(true);
  });
});

/*
 * ここが回帰テストの本体。
 * React Flow は measured の無いノードを「未採寸」とみなし visibility: hidden で
 * 描画する。しかも DOM の寸法は変わらないため ResizeObserver が再発火せず、
 * 一度 measured を落とすとノードは二度と表示されない（実機で発生した不具合）。
 * jsdom では採寸そのものが走らないため、採寸結果の受け渡しを
 * applyNodeChanges（React Flow 本体の関数）で再現して検証する。
 */
describe("mergePreservingMeasured", () => {
  it("採寸済みノードの measured を次の世代へ引き継ぐ", () => {
    const flowNodesOf = makeFlowNodes();
    const measured = measureAll(flowNodesOf());
    expect(measured.every((node) => node.measured?.width === 180)).toBe(true);

    // reducer 側が更新した新しいノード配列（measured を持たない）
    const next = flowNodesOf("A");
    expect(next.every((node) => node.measured === undefined)).toBe(true);
    const merged = mergePreservingMeasured(measured, next);

    expect(merged).toHaveLength(next.length);
    expect(merged.every((node) => node.measured?.width === 180)).toBe(true);
    expect(merged.every((node) => node.measured?.height === 44)).toBe(true);
  });

  it("位置と data は新しい世代の値が勝つ（正は reducer 側）", () => {
    const flowNodesOf = makeFlowNodes();
    const initial = measureAll(flowNodesOf());
    const next = flowNodesOf("A").map((node) => ({ ...node, position: { x: 11, y: 22 } }));
    const merged = mergePreservingMeasured(initial, next);

    expect(merged.every((node) => node.position.x === 11 && node.position.y === 22)).toBe(true);
    expect(merged.find((node) => node.data.text === "A")?.data.selected).toBe(true);
    expect(merged.find((node) => node.data.text === "root")?.data.selected).toBe(false);
  });

  it("何世代くり返しても measured が落ちない", () => {
    const flowNodesOf = makeFlowNodes();
    let current = measureAll(flowNodesOf());
    for (let i = 0; i < 10; i += 1) {
      current = mergePreservingMeasured(current, flowNodesOf(i % 2 === 0 ? "A" : "B"));
      expect(current.every((node) => node.measured?.width === 180)).toBe(true);
    }
  });

  it("新しく増えたノードは measured を持たない（React Flow がこれから採寸する）", () => {
    const flowNodesOf = makeFlowNodes();
    const initial = flowNodesOf();
    const measured = measureAll(initial);
    const added: MindMapFlowNode = { ...initial[0], id: "new-node", measured: undefined };
    const merged = mergePreservingMeasured(measured, [...flowNodesOf(), added]);

    const newcomer = merged.find((node) => node.id === "new-node");
    expect(newcomer).toBeDefined();
    expect(newcomer?.measured).toBeUndefined();
    // 既存ノードの measured は保たれたまま
    expect(merged.filter((node) => node.measured?.width === 180)).toHaveLength(initial.length);
  });

  it("消えたノードは引き継がれない", () => {
    const flowNodesOf = makeFlowNodes();
    const measured = measureAll(flowNodesOf());
    const merged = mergePreservingMeasured(measured, [flowNodesOf()[0]]);
    expect(merged).toHaveLength(1);
  });

  it("前回が空（初回描画）のときはそのまま返す", () => {
    const next = makeFlowNodes()();
    expect(mergePreservingMeasured([], next)).toBe(next);
  });
});
