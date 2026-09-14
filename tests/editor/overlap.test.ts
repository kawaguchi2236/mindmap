/**
 * ノード同士が重ならないことの検証。
 *
 * 実機で「折り返した長いノードに、別の親の子ノードが被る」不具合が出た。
 * 原因は、ノードを増やしたり文字を打って行数が増えたときに、
 * 直近の親の階層しか積み直しておらず、部分木が伸びたことが祖先に
 * 伝わっていなかったこと（restackSiblings → restackAncestors）。
 *
 * ここでは「どのような操作の並びでも、見えているノードが1組も重ならない」
 * という不変条件を、Enter / Tab / Shift+Tab / 削除 / 折りたたみ / 貼り付け
 * といった経路ごとに固定する。個別の座標ではなく不変条件を見ているので、
 * レイアウトの数値を調整しても壊れない。
 */
import { describe, expect, it } from "vitest";
import { copySubtree } from "@/features/editor/clipboard";
import { estimateNodeHeight, layoutTree, NODE_WIDTH } from "@/features/editor/layout";
import {
  createInitialState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from "@/features/editor/reducer";
import { getVisibleNodes } from "@/features/editor/tree";
import type { MindMapNode } from "@/lib/model/types";
import { buildTree, findByText } from "./helpers";

/** 2行に折り返す長さ。 */
const TWO_LINES = "これは必ず２行に折り返す長いテキストです";
/** 3行以上に折り返す長さ。 */
const MANY_LINES =
  "これはとても長いテキストで、ノードの中で何行にも折り返すことを意図しています。重なりの検証用です。";

type Rect = { id: string; text: string; left: number; right: number; top: number; bottom: number };

function toRect(node: MindMapNode): Rect {
  return {
    id: node.id,
    text: node.text,
    left: node.x,
    right: node.x + NODE_WIDTH,
    top: node.y,
    bottom: node.y + estimateNodeHeight(node.text),
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 見えているノードのうち、矩形が重なっている組を返す。 */
function findOverlaps(nodes: MindMapNode[]): string[] {
  const rects = getVisibleNodes(nodes).map(toRect);
  const overlaps: string[] = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      if (intersects(rects[i], rects[j])) {
        overlaps.push(
          `「${rects[i].text || "(空)"}」(y ${rects[i].top}–${rects[i].bottom}) と ` +
            `「${rects[j].text || "(空)"}」(y ${rects[j].top}–${rects[j].bottom})`,
        );
      }
    }
  }
  return overlaps;
}

function expectNoOverlap(state: EditorState): void {
  expect(findOverlaps(state.nodes)).toEqual([]);
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

function start(spec: Parameters<typeof buildTree>[0]): EditorState {
  return createInitialState(layoutTree(buildTree(spec)));
}

/** 選択中のノードに文字を入れる。新規作成直後は編集モードなのでこの形が実操作に近い。 */
function type(state: EditorState, text: string): EditorState {
  if (state.selectedId === null) throw new Error("選択がありません");
  return editorReducer(state, { type: "updateText", id: state.selectedId, text });
}

const ROOT_ONLY = { text: "root" };

describe("ノードが重ならないこと", () => {
  it("Enter を繰り返して兄弟を増やしても重ならない", () => {
    let state = run(start(ROOT_ONLY), { type: "createChild" });
    for (let i = 0; i < 10; i += 1) {
      state = type(state, `兄弟${i}`);
      state = editorReducer(state, { type: "createSibling" });
      expectNoOverlap(state);
    }
    expect(getVisibleNodes(state.nodes)).toHaveLength(12);
  });

  it("Tab を繰り返して階層を深くしても重ならない", () => {
    let state = start(ROOT_ONLY);
    for (let i = 0; i < 10; i += 1) {
      state = editorReducer(state, { type: "createChild" });
      state = type(state, `子${i}`);
      expectNoOverlap(state);
    }
    expect(getVisibleNodes(state.nodes)).toHaveLength(11);
  });

  it("Tab と Enter を交互に押しても重ならない", () => {
    let state = start(ROOT_ONLY);
    for (let i = 0; i < 6; i += 1) {
      state = editorReducer(state, { type: "createChild" });
      state = type(state, `子${i}`);
      expectNoOverlap(state);
      state = editorReducer(state, { type: "createSibling" });
      state = type(state, `兄弟${i}`);
      expectNoOverlap(state);
    }
  });

  it("兄弟を複数作ってから、それぞれに子を足しても重ならない", () => {
    // 実機で崩れた形。親が2つ並び、両方が子を持つと下の親の部分木に食い込んでいた。
    let state = run(start(ROOT_ONLY), { type: "createChild" });
    state = type(state, "親A");
    state = editorReducer(state, { type: "createSibling" });
    state = type(state, "親B");
    expectNoOverlap(state);

    for (const parentText of ["親A", "親B"]) {
      const parent = findByText(state.nodes, parentText);
      for (let i = 0; i < 3; i += 1) {
        state = editorReducer(state, { type: "createChild", id: parent.id });
        state = type(state, `${parentText}の子${i}`);
        expectNoOverlap(state);
      }
    }
  });

  it("深いノードに長文を入れても、祖先の兄弟に食い込まない", () => {
    // restackAncestors が無いと、ここで「親B」以下が元の位置に残って重なる。
    let state = start({
      text: "root",
      children: [
        { text: "親A", children: [{ text: "孫A1" }, { text: "孫A2" }] },
        { text: "親B", children: [{ text: "孫B1" }] },
      ],
    });
    expectNoOverlap(state);

    const deep = findByText(state.nodes, "孫A1");
    state = editorReducer(state, { type: "updateText", id: deep.id, text: MANY_LINES });
    expectNoOverlap(state);
  });

  it("長文を入れてから短くしても重ならない", () => {
    let state = start({
      text: "root",
      children: [{ text: "A" }, { text: "B" }, { text: "C" }],
    });
    const target = findByText(state.nodes, "A");
    state = editorReducer(state, { type: "updateText", id: target.id, text: MANY_LINES });
    expectNoOverlap(state);
    state = editorReducer(state, { type: "updateText", id: target.id, text: "A" });
    expectNoOverlap(state);
  });

  it("長文ノードの隣で Enter / Tab を押しても重ならない", () => {
    let state = start({ text: "root", children: [{ text: TWO_LINES }, { text: "後ろ" }] });
    const long = findByText(state.nodes, TWO_LINES);

    state = editorReducer(state, { type: "createSibling", id: long.id });
    state = type(state, MANY_LINES);
    expectNoOverlap(state);

    state = editorReducer(state, { type: "createChild", id: long.id });
    state = type(state, TWO_LINES);
    expectNoOverlap(state);
  });

  it("Shift+Tab（outdent）で階層を上げても重ならない", () => {
    let state = start({
      text: "root",
      children: [
        { text: "親A", children: [{ text: "孫A1" }, { text: MANY_LINES }] },
        { text: "親B", children: [{ text: "孫B1" }] },
      ],
    });
    const target = findByText(state.nodes, MANY_LINES);
    state = editorReducer(state, { type: "outdent", id: target.id });
    expectNoOverlap(state);
  });

  it("削除しても残りが重ならない", () => {
    let state = start({
      text: "root",
      children: [
        { text: "親A", children: [{ text: MANY_LINES }, { text: "孫A2" }] },
        { text: "親B", children: [{ text: "孫B1" }] },
      ],
    });
    const target = findByText(state.nodes, MANY_LINES);
    state = editorReducer(state, { type: "deleteNode", id: target.id });
    expectNoOverlap(state);
  });

  it("折りたたみと展開のどちらでも重ならない", () => {
    let state = start({
      text: "root",
      children: [
        { text: "親A", children: [{ text: MANY_LINES }, { text: "孫A2" }] },
        { text: "親B", children: [{ text: "孫B1" }] },
      ],
    });
    const parentA = findByText(state.nodes, "親A");
    state = editorReducer(state, { type: "toggleCollapse", id: parentA.id });
    expectNoOverlap(state);
    state = editorReducer(state, { type: "toggleCollapse", id: parentA.id });
    expectNoOverlap(state);
  });

  it("貼り付けても重ならない", () => {
    let state = start({
      text: "root",
      children: [
        { text: "親A", children: [{ text: MANY_LINES }, { text: "孫A2" }] },
        { text: "親B" },
      ],
    });
    const source = findByText(state.nodes, "親A");
    const clipboard = copySubtree(state.nodes, source.id);
    expect(clipboard).not.toBeNull();
    const parentB = findByText(state.nodes, "親B");
    state = editorReducer(state, { type: "paste", clipboard: clipboard!, parentId: parentB.id });
    expectNoOverlap(state);
  });

  it("自動整列のあとも重ならない", () => {
    let state = start(ROOT_ONLY);
    for (let i = 0; i < 4; i += 1) {
      state = editorReducer(state, { type: "createChild" });
      state = type(state, i % 2 === 0 ? MANY_LINES : `子${i}`);
      state = editorReducer(state, { type: "createSibling" });
      state = type(state, `兄弟${i}`);
    }
    expectNoOverlap(state);
    state = editorReducer(state, { type: "relayout" });
    expectNoOverlap(state);
  });
});

describe("手で動かして重なった状態からでも、Enter / Tab で解消される", () => {
  /** ノードをドラッグで重ねた状態を作る。 */
  function dragOnto(state: EditorState, movedText: string, targetText: string): EditorState {
    const moved = findByText(state.nodes, movedText);
    const target = findByText(state.nodes, targetText);
    return editorReducer(state, {
      type: "moveNode",
      id: moved.id,
      x: target.x,
      y: target.y + 4,
    });
  }

  const SPEC = {
    text: "root",
    children: [{ text: "A", children: [{ text: "A1" }] }, { text: "B" }, { text: "C" }],
  };

  it("重なった状態を作れていることをまず確認する", () => {
    const state = dragOnto(start(SPEC), "C", "B");
    expect(findOverlaps(state.nodes)).not.toEqual([]);
  });

  it("Enter（兄弟追加）を押すと重なりが解消する", () => {
    let state = dragOnto(start(SPEC), "C", "B");
    const b = findByText(state.nodes, "B");
    state = editorReducer(state, { type: "createSibling", id: b.id });
    expectNoOverlap(state);
  });

  it("Tab（子追加）を押すと重なりが解消する", () => {
    let state = dragOnto(start(SPEC), "C", "B");
    const b = findByText(state.nodes, "B");
    state = editorReducer(state, { type: "createChild", id: b.id });
    expectNoOverlap(state);
  });

  it("文字を打っても重なりが解消する", () => {
    let state = dragOnto(start(SPEC), "C", "B");
    const b = findByText(state.nodes, "B");
    state = editorReducer(state, { type: "updateText", id: b.id, text: MANY_LINES });
    expectNoOverlap(state);
  });

  it("新しいノードは空いているところに出る（既存のノードに被らない）", () => {
    // ドラッグで散らかした状態でも、追加したノードが既存に重ならないこと。
    let state = start(SPEC);
    const a = findByText(state.nodes, "A");
    state = editorReducer(state, { type: "moveNode", id: a.id, x: 400, y: 120 });
    const c = findByText(state.nodes, "C");
    state = editorReducer(state, { type: "moveNode", id: c.id, x: 400, y: 150 });

    state = editorReducer(state, { type: "createChild", id: findByText(state.nodes, "B").id });
    state = type(state, MANY_LINES);
    expectNoOverlap(state);
  });

  it("先に置いたノードは動かさず、後から来たほうを下げる", () => {
    let state = dragOnto(start(SPEC), "C", "B");
    const beforeB = findByText(state.nodes, "B");
    state = editorReducer(state, { type: "createChild", id: beforeB.id });
    const afterB = findByText(state.nodes, "B");
    // B は order が先なので動かない。後ろの C 側が下がる。
    expect({ x: afterB.x, y: afterB.y }).toEqual({ x: beforeB.x, y: beforeB.y });
    expectNoOverlap(state);
  });

  it("操作した枝とは別の枝に残った重なりも解消される", () => {
    /*
     * 積み直し（restackAncestors）は「操作したノードから根まで」の各階層しか
     * 触らない。別の枝の中で重なっているものはそのまま残る。
     * ユーザーから見れば同じ「被っている」なので、ここも解消する必要がある。
     */
    let state = start({
      text: "root",
      children: [
        { text: "A", children: [{ text: "A1" }, { text: "A2" }] },
        { text: "B", children: [{ text: "B1" }] },
      ],
    });
    // A の枝の中で重ねる（A は以降の操作の経路に入らない）。
    const a1 = findByText(state.nodes, "A1");
    const a2 = findByText(state.nodes, "A2");
    state = editorReducer(state, { type: "moveNode", id: a2.id, x: a1.x, y: a1.y + 6 });
    expect(findOverlaps(state.nodes)).not.toEqual([]);

    // B の枝で Enter を押す。経路は B → root で、A の子には触れない。
    state = editorReducer(state, { type: "createSibling", id: findByText(state.nodes, "B1").id });
    expectNoOverlap(state);
  });

  it("別の列へドラッグして重ねた場合も解消される", () => {
    // 縦の積み直しは y しか見ないので、x をまたいで重ねたものは残ってしまう。
    let state = start({
      text: "root",
      children: [
        { text: "A", children: [{ text: "A1" }] },
        { text: "B", children: [{ text: "B1" }] },
      ],
    });
    // B1 を親の列（A や B が並ぶ列）へ動かして A に重ねる。
    const b1 = findByText(state.nodes, "B1");
    const a = findByText(state.nodes, "A");
    state = editorReducer(state, { type: "moveNode", id: b1.id, x: a.x, y: a.y + 6 });
    expect(findOverlaps(state.nodes)).not.toEqual([]);

    // B1 に子を足す。B の子の積み直しは y しか直さないので、x のずれは残る。
    state = editorReducer(state, { type: "createChild", id: findByText(state.nodes, "B1").id });
    expectNoOverlap(state);
  });

  it("ドラッグそのものでは勝手に整列しない（ユーザーの操作を尊重する）", () => {
    // 重なり解消は構造が変わったときだけ。ドラッグ中に勝手に動くと操作できない。
    const state = dragOnto(start(SPEC), "C", "B");
    const c = findByText(state.nodes, "C");
    const b = findByText(state.nodes, "B");
    expect(c.y).toBe(b.y + 4);
  });
});

describe("重なり検出そのものの健全性", () => {
  it("実際に重ねた座標は重なりとして検出される", () => {
    // findOverlaps が常に空配列を返すだけの無意味な検査になっていないことを固定する。
    const nodes = layoutTree(buildTree({ text: "root", children: [{ text: "A" }, { text: "B" }] }));
    const a = findByText(nodes, "A");
    const broken = nodes.map((n) => (n.id === a.id ? { ...n, x: 0, y: 0 } : n));
    const root = broken.find((n) => n.parentId === null)!;
    expect(findOverlaps([...broken, { ...root, id: "dup", parentId: root.parentId }])).not.toEqual(
      [],
    );
  });
});
