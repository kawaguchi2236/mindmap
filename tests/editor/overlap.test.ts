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
import { layoutTree, nodeBox } from "@/features/editor/layout";
import {
  createInitialState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from "@/features/editor/reducer";
import { buildDepthIndex, getVisibleNodes } from "@/features/editor/tree";
import type { MindMapNode } from "@/lib/model/types";
import { buildTree, findByText } from "./helpers";

/** 2行に折り返す長さ。 */
const TWO_LINES = "これは必ず２行に折り返す長いテキストです";
/** 3行以上に折り返す長さ。 */
const MANY_LINES =
  "これはとても長いテキストで、ノードの中で何行にも折り返すことを意図しています。重なりの検証用です。";

type Rect = { id: string; text: string; left: number; right: number; top: number; bottom: number };

/** ノードの大きさは階層ごとの文字組みで決まるので、深さを渡して求める。 */
function toRect(node: MindMapNode, depth: number): Rect {
  const box = nodeBox(node.text, depth);
  return {
    id: node.id,
    text: node.text,
    left: node.x,
    right: node.x + box.width,
    top: node.y,
    bottom: node.y + box.height,
  };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** 見えているノードのうち、矩形が重なっている組を返す。 */
function findOverlaps(nodes: MindMapNode[]): string[] {
  const depths = buildDepthIndex(nodes);
  const rects = getVisibleNodes(nodes).map((node) => toRect(node, depths.get(node.id) ?? 0));
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

describe("ドラッグで動かしても重ならない", () => {
  /** ノードを別のノードの上へドラッグして落とす。 */
  function dropOnto(state: EditorState, movedText: string, targetText: string): EditorState {
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

  it("他のノードの上に落としても重ならない", () => {
    const state = dropOnto(start(SPEC), "C", "B");
    expectNoOverlap(state);
  });

  it("落としたノードはその場に残り、被った相手のほうが下がる", () => {
    // ドロップ先はユーザーが指した場所。動かした本人を勝手に押し戻さない。
    const before = start(SPEC);
    const b = findByText(before.nodes, "B");
    const state = dropOnto(before, "C", "B");

    expect(findByText(state.nodes, "C").y).toBe(b.y + 4);
    expect(findByText(state.nodes, "B").y).toBeGreaterThan(b.y);
    expectNoOverlap(state);
  });

  it("空いているところへ落としたら誰も動かない", () => {
    const before = start(SPEC);
    const c = findByText(before.nodes, "C");
    const state = editorReducer(before, { type: "moveNode", id: c.id, x: 900, y: 900 });

    for (const node of before.nodes) {
      if (node.id === c.id) continue;
      const after = state.nodes.find((n) => n.id === node.id)!;
      expect({ x: after.x, y: after.y }).toEqual({ x: node.x, y: node.y });
    }
    expectNoOverlap(state);
  });

  it("自分の子の上に落としても重ならない", () => {
    // 固定するのは動かしたノードだけなので、子のほうが逃げる。
    const state = dropOnto(start(SPEC), "A", "A1");
    expectNoOverlap(state);
  });

  it("別の列へ落としても重ならない", () => {
    const state = dropOnto(start(SPEC), "A1", "B");
    expectNoOverlap(state);
  });

  it("何度ドラッグしても重ならない", () => {
    let state = start({
      text: "root",
      children: [
        { text: TWO_LINES, children: [{ text: MANY_LINES }] },
        { text: "B", children: [{ text: "B1" }, { text: "B2" }] },
        { text: "C" },
      ],
    });
    const targets = ["C", "B1", "B2", MANY_LINES, "B"];
    targets.forEach((text, i) => {
      const moved = findByText(state.nodes, text);
      state = editorReducer(state, {
        type: "moveNode",
        id: moved.id,
        // 既存のノードが並ぶ範囲を狙って、必ず何かに被らせる。
        x: i % 2 === 0 ? 320 : 620,
        y: 40 * i,
      });
      expectNoOverlap(state);
    });
  });

  it("ドラッグのあとに Enter を押しても重ならない", () => {
    let state = dropOnto(start(SPEC), "C", "B");
    state = editorReducer(state, { type: "createSibling", id: findByText(state.nodes, "B").id });
    expectNoOverlap(state);
  });
});

describe("保存済みの重なった座標も解消される", () => {
  /*
   * ドラッグでは重ならなくなったが、レイアウトを直す前に保存されたマップには
   * 重なった座標が残っている。開いたときと、次の操作のどちらでも解消する。
   */
  const SPEC = {
    text: "root",
    children: [
      { text: "A", children: [{ text: "A1" }, { text: "A2" }] },
      { text: "B", children: [{ text: "B1" }] },
    ],
  };

  /** reducer を通さずに座標を重ねる（＝古い保存データが読み込まれた状態）。 */
  function overlapped(nodes: MindMapNode[], movedText: string, targetText: string): MindMapNode[] {
    const moved = findByText(nodes, movedText);
    const target = findByText(nodes, targetText);
    return nodes.map((node) =>
      node.id === moved.id ? { ...node, x: target.x, y: target.y + 4 } : node,
    );
  }

  it("重なった座標を作れていることをまず確認する", () => {
    const nodes = overlapped(layoutTree(buildTree(SPEC)), "A2", "A1");
    expect(findOverlaps(nodes)).not.toEqual([]);
  });

  it("開いた時点で解消される", () => {
    const nodes = overlapped(layoutTree(buildTree(SPEC)), "A2", "A1");
    expectNoOverlap(createInitialState(nodes));
  });

  it("操作した枝とは別の枝に残った重なりも解消される", () => {
    /*
     * 積み直し（restackAncestors）は「操作したノードから根まで」の各階層しか
     * 触らない。別の枝の中で重なっているものはそのまま残る。
     * ユーザーから見れば同じ「被っている」なので、ここも解消する必要がある。
     */
    const base = start(SPEC);
    // A の枝の中で重ねる（A は以降の操作の経路に入らない）。
    let state: EditorState = { ...base, nodes: overlapped(base.nodes, "A2", "A1") };
    expect(findOverlaps(state.nodes)).not.toEqual([]);

    // B の枝で Enter を押す。経路は B → root で、A の子には触れない。
    state = editorReducer(state, { type: "createSibling", id: findByText(state.nodes, "B1").id });
    expectNoOverlap(state);
  });

  it("列をまたいで重なっていても解消される", () => {
    // 縦の積み直しは y しか見ないので、x をまたいだ重なりはここで落とす。
    const base = start(SPEC);
    let state: EditorState = { ...base, nodes: overlapped(base.nodes, "B1", "A") };
    expect(findOverlaps(state.nodes)).not.toEqual([]);

    state = editorReducer(state, { type: "createChild", id: findByText(state.nodes, "B1").id });
    expectNoOverlap(state);
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

describe("どんな操作の並びでも重ならない（乱数）", () => {
  /*
   * 個別の経路を並べても、実際の使われ方（作る・打つ・動かすが混ざる）は
   * 尽くせない。決まった種から操作列を作って、どの途中経過でも
   * 「見えているノードが1組も重ならない」ことを確かめる。
   * 種を固定しているので、落ちたら必ず同じ並びで再現できる。
   */
  function randomFrom(seed: number): () => number {
    let value = seed;
    return () => (value = (value * 1664525 + 1013904223) >>> 0) / 0x100000000;
  }

  const TEXTS = ["", "短い", "A", TWO_LINES, MANY_LINES, "Tabで追加した長いテキストのノード"];

  for (const seed of [1, 7, 13, 42, 99, 271]) {
    it(`種 ${seed} の操作列`, () => {
      const random = randomFrom(seed);
      const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
      let state = start(ROOT_ONLY);

      for (let step = 0; step < 120; step += 1) {
        const id = pick(getVisibleNodes(state.nodes)).id;
        const dice = random();
        if (dice < 0.22) state = editorReducer(state, { type: "createChild", id });
        else if (dice < 0.4) state = editorReducer(state, { type: "createSibling", id });
        else if (dice < 0.56)
          state = editorReducer(state, { type: "updateText", id, text: pick(TEXTS) });
        else if (dice < 0.82)
          // ドラッグ。既存のノードが並ぶ範囲を狙って、わざと被らせにいく。
          state = editorReducer(state, {
            type: "moveNode",
            id,
            x: Math.floor(random() * 900) - 100,
            y: Math.floor(random() * 900) - 100,
          });
        else if (dice < 0.89) state = editorReducer(state, { type: "toggleCollapse", id });
        else if (dice < 0.96) state = editorReducer(state, { type: "deleteNode", id });
        else state = editorReducer(state, { type: "outdent", id });

        // どの step で崩れたかが分かるように step ごと比較する。
        expect({ step, overlaps: findOverlaps(state.nodes) }).toEqual({ step, overlaps: [] });
      }
    });
  }
});
