import { describe, expect, it } from "vitest";
import {
  estimateLineCount,
  estimateNodeHeight,
  layoutTree,
  NODE_HEIGHT,
  V_GAP,
} from "@/features/editor/layout";
import { editorReducer, createInitialState } from "@/features/editor/reducer";
import { getChildren, getRoot } from "@/features/editor/tree";
import { buildTree, findByText } from "./helpers";

/**
 * ノードの重なりの回帰テスト。
 *
 * レイアウトが全ノードを 44px 固定と仮定していたため、テキストが折り返した
 * ノードの下に兄弟が食い込んでいた（実機で 61px のノードの下に y=60 で配置）。
 * 採寸は使えない構成なので、テキストから高さを見積もる方式が正しいかを見る。
 */

/** 兄弟同士が縦に重なっていないことを全ペアで確認する。 */
function expectNoSiblingOverlap(nodes: ReturnType<typeof buildTree>): void {
  const parentIds = new Set<string | null>(nodes.map((node) => node.parentId));
  for (const parentId of parentIds) {
    const siblings = getChildren(nodes, parentId);
    for (let i = 0; i < siblings.length - 1; i += 1) {
      const current = siblings[i];
      const next = siblings[i + 1];
      const bottom = current.y + estimateNodeHeight(current.text);
      expect(
        bottom,
        `「${current.text}」(y=${current.y}, h=${estimateNodeHeight(current.text)}) が ` +
          `「${next.text}」(y=${next.y}) に食い込んでいます`,
      ).toBeLessThanOrEqual(next.y);
    }
  }
}

describe("estimateNodeHeight", () => {
  it("1行なら従来と同じ 44px（既存レイアウトを変えない）", () => {
    expect(estimateNodeHeight("")).toBe(NODE_HEIGHT);
    expect(estimateNodeHeight("短い")).toBe(NODE_HEIGHT);
    expect(estimateLineCount("短い")).toBe(1);
  });

  it("全角で折り返す長さになったら2行ぶんの高さになる", () => {
    // 全角10文字 = 10 × 14px × 1.05 = 147 > 140 なので2行
    expect(estimateLineCount("実機テスト兄弟ノード")).toBe(2);
    expect(estimateNodeHeight("実機テスト兄弟ノード")).toBeGreaterThan(NODE_HEIGHT);
  });

  it("実際の描画高さより小さく見積もらない（安全側）", () => {
    // 実機実測: "実機テスト兄弟ノード" の高さは 61px
    expect(estimateNodeHeight("実機テスト兄弟ノード")).toBeGreaterThanOrEqual(61);
  });

  it("改行を含むテキストは行数に数える", () => {
    expect(estimateLineCount("あ\nい\nう")).toBe(3);
    expect(estimateNodeHeight("あ\nい\nう")).toBeGreaterThan(estimateNodeHeight("あ"));
  });

  it("半角は全角より多く入る", () => {
    expect(estimateLineCount("abcdefghij")).toBe(1);
    expect(estimateLineCount("実機テスト兄弟ノード")).toBe(2);
  });
});

describe("折り返すノードがある木のレイアウト", () => {
  const SPEC = {
    text: "ルート",
    children: [
      { text: "実機テスト兄弟ノード" }, // 2行に折り返す
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
    const wrapped = findByText(nodes, "実機テスト兄弟ノード");
    const below = findByText(nodes, "（無題）");
    expect(below.y - wrapped.y).toBe(estimateNodeHeight(wrapped.text) + V_GAP);
  });

  it("Enter でノードを足しても重ならない", () => {
    const nodes = layoutTree(buildTree(SPEC));
    let state = createInitialState(nodes);
    state = { ...state, selectedId: findByText(state.nodes, "実機テスト兄弟ノード").id };
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
