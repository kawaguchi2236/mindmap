import { describe, expect, it } from "vitest";
import { copySubtree } from "@/features/editor/clipboard";
import { layoutTree } from "@/features/editor/layout";
import {
  createInitialState,
  editorReducer,
  type EditorAction,
  type EditorState,
} from "@/features/editor/reducer";
import { getChildren, getNode } from "@/features/editor/tree";
import { buildTree, childTexts, findByText, outline, rootId } from "./helpers";

const SPEC = {
  text: "root",
  children: [{ text: "A", children: [{ text: "A1" }, { text: "A2" }] }, { text: "B" }],
};

function setup(selectedText?: string): EditorState {
  const nodes = layoutTree(buildTree(SPEC));
  const state = createInitialState(nodes);
  if (!selectedText) return state;
  return { ...state, selectedId: findByText(nodes, selectedText).id };
}

function run(state: EditorState, ...actions: EditorAction[]): EditorState {
  return actions.reduce(editorReducer, state);
}

describe("editorReducer", () => {
  it("初期状態ではルートが選択され、編集はしていない", () => {
    const state = setup();
    expect(getNode(state.nodes, state.selectedId)?.text).toBe("root");
    expect(state.editingId).toBeNull();
  });

  it("Enter（createSibling）で選択ノードの直後に兄弟ができ、即編集モードに入る", () => {
    const next = editorReducer(setup("A"), { type: "createSibling" });
    expect(childTexts(next.nodes, rootId(next.nodes))).toEqual(["A", "", "B"]);
    expect(next.selectedId).not.toBeNull();
    expect(next.editingId).toBe(next.selectedId);
    expect(getNode(next.nodes, next.selectedId)?.parentId).toBe(
      findByText(next.nodes, "A").parentId,
    );
  });

  it("ルート上の Enter は兄弟ではなく子を作る（ルートは1マップに1つ）", () => {
    const next = editorReducer(setup(), { type: "createSibling" });
    expect(next.nodes.filter((node) => node.parentId === null)).toHaveLength(1);
    expect(childTexts(next.nodes, rootId(next.nodes))).toEqual(["A", "B", ""]);
  });

  it("Tab（createChild）で末尾に子ができ、即編集モードに入る", () => {
    const next = editorReducer(setup("A"), { type: "createChild" });
    const a = findByText(next.nodes, "A");
    expect(childTexts(next.nodes, a.id)).toEqual(["A1", "A2", ""]);
    expect(next.editingId).toBe(next.selectedId);
    expect(getNode(next.nodes, next.selectedId)?.parentId).toBe(a.id);
  });

  it("折りたたまれた親の下に子を作ると親が開く", () => {
    const base = setup("A");
    const collapsed = editorReducer(base, {
      type: "toggleCollapse",
      id: findByText(base.nodes, "A").id,
    });
    expect(findByText(collapsed.nodes, "A").collapsed).toBe(true);
    const next = editorReducer(collapsed, {
      type: "createChild",
      id: findByText(collapsed.nodes, "A").id,
    });
    expect(findByText(next.nodes, "A").collapsed).toBe(false);
  });

  it("Shift+Tab（outdent）で階層が1つ上がり、子孫は一緒に移動する", () => {
    const state = setup("A1");
    const next = editorReducer(state, { type: "outdent" });
    expect(childTexts(next.nodes, rootId(next.nodes))).toEqual(["A", "A1", "B"]);
    expect(childTexts(next.nodes, findByText(next.nodes, "A").id)).toEqual(["A2"]);
    expect(next.selectedId).toBe(findByText(next.nodes, "A1").id);
  });

  it("outdent で部分木ごと左へ寄る", () => {
    const withChild = editorReducer(setup("A1"), { type: "createChild" });
    const named = {
      ...withChild,
      nodes: withChild.nodes.map((n) => (n.text === "" ? { ...n, text: "A1a" } : n)),
    };
    const before = findByText(named.nodes, "A1a").x - findByText(named.nodes, "A1").x;
    const next = editorReducer(
      { ...named, selectedId: findByText(named.nodes, "A1").id },
      { type: "outdent" },
    );
    expect(findByText(next.nodes, "A1").x).toBe(findByText(next.nodes, "A").x);
    expect(findByText(next.nodes, "A1a").x - findByText(next.nodes, "A1").x).toBe(before);
  });

  it("ルートと、ルート直下の子は outdent できない", () => {
    const onRoot = setup();
    expect(editorReducer(onRoot, { type: "outdent" })).toBe(onRoot);
    const onA = setup("A");
    expect(editorReducer(onA, { type: "outdent" })).toBe(onA);
  });

  it("削除すると子孫も消え、選択は直前の兄弟へ移る", () => {
    const state = setup("B");
    const next = editorReducer(state, { type: "deleteNode" });
    expect(outline(next.nodes)).toEqual(["root", "  A", "    A1", "    A2"]);
    expect(next.selectedId).toBe(findByText(next.nodes, "A").id);

    const deleteA = editorReducer(setup("A"), { type: "deleteNode" });
    expect(deleteA.nodes.map((node) => node.text).sort()).toEqual(["B", "root"]);
    // 直前の兄弟がなければ親へ
    expect(deleteA.selectedId).toBe(rootId(deleteA.nodes));
  });

  it("ルートは削除できない", () => {
    const state = setup();
    expect(editorReducer(state, { type: "deleteNode" })).toBe(state);
  });

  it("updateText はテキストだけを変え、同じ値なら状態を変えない", () => {
    const state = setup("A");
    const id = findByText(state.nodes, "A").id;
    const next = editorReducer(state, { type: "updateText", id, text: "あ" });
    expect(getNode(next.nodes, id)?.text).toBe("あ");
    expect(editorReducer(next, { type: "updateText", id, text: "あ" })).toBe(next);
  });

  it("moveNode は座標だけを変える", () => {
    const state = setup("A");
    const id = findByText(state.nodes, "A").id;
    const next = editorReducer(state, { type: "moveNode", id, x: 10, y: 20 });
    expect(getNode(next.nodes, id)).toMatchObject({ x: 10, y: 20 });
    expect(getChildren(next.nodes, id).map((n) => n.text)).toEqual(["A1", "A2"]);
  });

  it("toggleCollapse は子を持つノードにだけ効く", () => {
    const leaf = setup("B");
    expect(editorReducer(leaf, { type: "toggleCollapse" })).toBe(leaf);
    const state = setup("A");
    const collapsed = editorReducer(state, { type: "toggleCollapse" });
    expect(findByText(collapsed.nodes, "A").collapsed).toBe(true);
    expect(
      editorReducer(collapsed, { type: "toggleCollapse" }).nodes.find((n) => n.text === "A")
        ?.collapsed,
    ).toBe(false);
  });

  it("折りたたむと、内側にあった選択はその親へ移る", () => {
    const state = setup("A1");
    const next = editorReducer(state, {
      type: "toggleCollapse",
      id: findByText(state.nodes, "A").id,
    });
    expect(next.selectedId).toBe(findByText(next.nodes, "A").id);
  });

  it("コピー&ペーストで ID が振り直され、選択ノードの子に入る", () => {
    const state = setup("A");
    const clipboard = copySubtree(state.nodes, findByText(state.nodes, "A").id);
    expect(clipboard).not.toBeNull();

    const target = { ...state, selectedId: findByText(state.nodes, "B").id };
    const next = editorReducer(target, { type: "paste", clipboard: clipboard! });

    expect(next.nodes).toHaveLength(state.nodes.length + 3);
    expect(outline(next.nodes)).toEqual([
      "root",
      "  A",
      "    A1",
      "    A2",
      "  B",
      "    A",
      "      A1",
      "      A2",
    ]);
    const originalIds = new Set(state.nodes.map((node) => node.id));
    const pasted = next.nodes.filter((node) => !originalIds.has(node.id));
    expect(pasted).toHaveLength(3);
    expect(pasted.every((node) => !originalIds.has(node.id))).toBe(true);
    expect(next.selectedId).not.toBeNull();
    expect(originalIds.has(next.selectedId as string)).toBe(false);
    // 貼り付け直後は編集モードに入らない（テキストが既にあるため）
    expect(next.editingId).toBeNull();
  });

  it("ペーストした部分木は元の部分木と重ならない", () => {
    const state = setup("A");
    const clipboard = copySubtree(state.nodes, findByText(state.nodes, "A").id)!;
    const next = editorReducer(state, { type: "paste", clipboard });
    const originalIds = new Set(state.nodes.map((node) => node.id));
    const pastedRoot = next.nodes.find((node) => !originalIds.has(node.id) && node.text === "A");
    expect(pastedRoot?.y).toBeGreaterThan(findByText(state.nodes, "A2").y);
  });

  it("矢印キーで表示中のノードを移動でき、折りたたんだ先へは行かない", () => {
    const state = setup();
    const right = editorReducer(state, { type: "navigate", direction: "right" });
    expect(getNode(right.nodes, right.selectedId)?.text).toBe("A");
    const down = editorReducer(right, { type: "navigate", direction: "down" });
    expect(getNode(down.nodes, down.selectedId)?.text).toBe("B");
    const back = editorReducer(down, { type: "navigate", direction: "left" });
    expect(getNode(back.nodes, back.selectedId)?.text).toBe("root");

    const collapsed = run(
      setup("A"),
      { type: "toggleCollapse" },
      { type: "navigate", direction: "right" },
    );
    expect(getNode(collapsed.nodes, collapsed.selectedId)?.text).not.toBe("A1");
  });

  it("select / startEditing / stopEditing は編集状態だけを動かす", () => {
    const state = setup();
    const id = findByText(state.nodes, "A").id;
    const editing = run(state, { type: "select", id }, { type: "startEditing" });
    expect(editing.editingId).toBe(id);
    expect(editorReducer(editing, { type: "stopEditing" }).editingId).toBeNull();
    expect(editorReducer(editing, { type: "select", id: null })).toMatchObject({
      selectedId: null,
      editingId: null,
    });
    // ノードは一切変わらない
    expect(editing.nodes).toBe(state.nodes);
  });

  it("reset は与えられたノードで作り直す", () => {
    const other = layoutTree(buildTree({ text: "other" }));
    const next = editorReducer(setup("A"), { type: "reset", nodes: other });
    expect(next.nodes).toBe(other);
    expect(getNode(next.nodes, next.selectedId)?.text).toBe("other");
  });
});
