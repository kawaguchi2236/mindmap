import { describe, expect, it } from "vitest";
import { estimateLineCount, layoutTree, nodeHeight, tierOf, V_GAP } from "@/features/editor/layout";
import { editorReducer, createInitialState } from "@/features/editor/reducer";
import { buildDepthIndex, getChildren, getRoot } from "@/features/editor/tree";
import { buildTree, findByText, heightOf } from "./helpers";

/**
 * ノードの重なりの回帰テスト。
 *
 * レイアウトが全ノードを固定の高さと仮定していたため、テキストが折り返した
 * ノードの下に兄弟が食い込んでいた。採寸は使えない構成なので、テキストから
 * 高さを見積もる方式が正しいかを見る。
 *
 * ノードの文字組みは階層ごとに違う（design/ハンドオフ.md `#2b`）。
 * そのため見積もりは必ず「テキスト＋深さ」の組で行う。
 */

/** 兄弟同士が縦に重なっていないことを全ペアで確認する。 */
function expectNoSiblingOverlap(nodes: ReturnType<typeof buildTree>): void {
  const depths = buildDepthIndex(nodes);
  const parentIds = new Set<string | null>(nodes.map((node) => node.parentId));
  for (const parentId of parentIds) {
    const siblings = getChildren(nodes, parentId);
    for (let i = 0; i < siblings.length - 1; i += 1) {
      const current = siblings[i];
      const next = siblings[i + 1];
      const height = nodeHeight(current.text, depths.get(current.id) ?? 0);
      expect(
        bottomOf(current.y, height),
        `「${current.text}」(y=${current.y}, h=${height}) が ` +
          `「${next.text}」(y=${next.y}) に食い込んでいます`,
      ).toBeLessThanOrEqual(next.y);
    }
  }
}

function bottomOf(top: number, height: number): number {
  return top + height;
}

describe("ノードの高さの見積もり", () => {
  /** 第3階層（17px / 行送り 26px / 折り返し 220px）でおよそ 12 文字入る。 */
  const LEAF_DEPTH = 2;
  const ONE_LINE = "短い";
  const TWO_LINES = "これは第三階層で必ず折り返す長さの文字列です";

  it("1行なら行送り1つぶんの高さ", () => {
    const { lineHeight } = tierOf(LEAF_DEPTH);
    expect(nodeHeight("", LEAF_DEPTH)).toBe(lineHeight);
    expect(nodeHeight(ONE_LINE, LEAF_DEPTH)).toBe(lineHeight);
    expect(estimateLineCount(ONE_LINE, LEAF_DEPTH)).toBe(1);
  });

  it("折り返す長さになったら2行以上の高さになる", () => {
    expect(estimateLineCount(TWO_LINES, LEAF_DEPTH)).toBeGreaterThanOrEqual(2);
    expect(nodeHeight(TWO_LINES, LEAF_DEPTH)).toBeGreaterThan(nodeHeight(ONE_LINE, LEAF_DEPTH));
  });

  it("行数 × 行送り になっている（描画は padding を持たない）", () => {
    const { lineHeight } = tierOf(LEAF_DEPTH);
    expect(nodeHeight(TWO_LINES, LEAF_DEPTH)).toBe(
      estimateLineCount(TWO_LINES, LEAF_DEPTH) * lineHeight,
    );
  });

  it("改行を含むテキストは行数に数える", () => {
    expect(estimateLineCount("あ\nい\nう", LEAF_DEPTH)).toBe(3);
    expect(nodeHeight("あ\nい\nう", LEAF_DEPTH)).toBeGreaterThan(nodeHeight("あ", LEAF_DEPTH));
  });

  it("半角は全角より多く入る", () => {
    const wide = "あ".repeat(14);
    const narrow = "a".repeat(14);
    expect(estimateLineCount(wide, LEAF_DEPTH)).toBeGreaterThan(
      estimateLineCount(narrow, LEAF_DEPTH),
    );
  });

  it("浅い階層ほど大きく、同じテキストでも早く折り返す", () => {
    const text = "階層で組みが変わる";
    expect(nodeHeight(text, 0)).toBeGreaterThan(nodeHeight(text, 1));
    expect(nodeHeight(text, 1)).toBeGreaterThan(nodeHeight(text, LEAF_DEPTH));
    expect(estimateLineCount(text, 0)).toBeGreaterThanOrEqual(estimateLineCount(text, LEAF_DEPTH));
  });

  it("第3階層より深いところは同じ組みを使い回す", () => {
    expect(tierOf(5)).toBe(tierOf(2));
    expect(nodeHeight("あ", 5)).toBe(nodeHeight("あ", 2));
  });
});

describe("折り返すノードがある木のレイアウト", () => {
  const SPEC = {
    text: "ルート",
    children: [
      { text: "第二階層でも折り返す長さの見出し" }, // 2行に折り返す
      { text: "（無題）" },
      { text: "とても長いテキストを持つノードで三行以上になるはずのもの" },
      { text: "短い" },
    ],
  };

  it("layoutTree の結果で兄弟が重ならない", () => {
    const nodes = layoutTree(buildTree(SPEC));
    expectNoSiblingOverlap(nodes);
  });

  it("折り返したノードの下の兄弟は、その高さぶん下に置かれる", () => {
    const nodes = layoutTree(buildTree(SPEC));
    const wrapped = findByText(nodes, "第二階層でも折り返す長さの見出し");
    const below = findByText(nodes, "（無題）");
    expect(below.y - wrapped.y).toBe(heightOf(nodes, wrapped) + V_GAP);
  });

  it("Enter でノードを足しても重ならない", () => {
    const nodes = layoutTree(buildTree(SPEC));
    let state = createInitialState(nodes);
    state = {
      ...state,
      selectedId: findByText(state.nodes, "第二階層でも折り返す長さの見出し").id,
    };
    // 折り返したノードの直後に兄弟を作る（ユーザーが報告した操作）
    state = editorReducer(state, { type: "createSibling" });
    state = editorReducer(state, {
      type: "updateText",
      id: state.selectedId as string,
      text: "あたらしく作った長めのノードのテキスト",
    });
    expectNoSiblingOverlap(state.nodes);
  });

  it("自動整列でも重ならない", () => {
    const nodes = layoutTree(buildTree(SPEC));
    let state = createInitialState(nodes);
    state = { ...state, selectedId: getRoot(nodes)?.id ?? null };
    state = editorReducer(state, { type: "createChild" });
    state = editorReducer(state, {
      type: "updateText",
      id: state.selectedId as string,
      text: "追加したとても長いテキストのノードです折り返します",
    });
    state = editorReducer(state, { type: "relayout" });
    expectNoSiblingOverlap(state.nodes);
  });
});
