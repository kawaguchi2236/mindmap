import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistoryState,
  historyReducer,
  HISTORY_LIMIT,
  type HistoryAction,
  type HistoryState,
} from "@/features/editor/history";
import { layoutTree } from "@/features/editor/layout";
import { createInitialState } from "@/features/editor/reducer";
import { getNode } from "@/features/editor/tree";
import { buildTree, childTexts, findByText, outline, rootId } from "./helpers";

const SPEC = {
  text: "root",
  children: [{ text: "A", children: [{ text: "A1" }] }, { text: "B" }],
};

function setup(selectedText = "A"): HistoryState {
  const nodes = layoutTree(buildTree(SPEC));
  const base = createInitialState(nodes);
  return createHistoryState({ ...base, selectedId: findByText(nodes, selectedText).id });
}

function run(state: HistoryState, ...actions: HistoryAction[]): HistoryState {
  return actions.reduce(historyReducer, state);
}

describe("history", () => {
  it("ノードを変えないアクションは履歴に積まない", () => {
    const state = run(
      setup(),
      { type: "select", id: rootId(setup().present.nodes) },
      { type: "startEditing" },
      { type: "stopEditing" },
      { type: "navigate", direction: "right" },
    );
    expect(canUndo(state)).toBe(false);
    expect(state.past).toHaveLength(0);
  });

  it("構造変更は Undo で往復する", () => {
    const before = setup();
    const created = historyReducer(before, { type: "createChild" });
    expect(childTexts(created.present.nodes, findByText(created.present.nodes, "A").id)).toEqual([
      "A1",
      "",
    ]);

    const undone = historyReducer(created, { type: "undo" });
    expect(outline(undone.present.nodes)).toEqual(outline(before.present.nodes));
    expect(canRedo(undone)).toBe(true);

    const redone = historyReducer(undone, { type: "redo" });
    expect(outline(redone.present.nodes)).toEqual(outline(created.present.nodes));
  });

  it("削除した部分木は Undo で丸ごと戻る", () => {
    const before = setup("A");
    const deleted = historyReducer(before, { type: "deleteNode" });
    expect(deleted.present.nodes).toHaveLength(2);
    const undone = historyReducer(deleted, { type: "undo" });
    expect(outline(undone.present.nodes)).toEqual(["root", "  A", "    A1", "  B"]);
  });

  it("テキスト入力は1文字ごとに履歴を積まず、編集セッション単位で戻る", () => {
    const state = setup("A");
    const id = findByText(state.present.nodes, "A").id;
    const typed = run(
      state,
      { type: "updateText", id, text: "あ" },
      { type: "updateText", id, text: "あい" },
      { type: "updateText", id, text: "あいう" },
    );
    expect(typed.past).toHaveLength(1);
    expect(getNode(typed.present.nodes, id)?.text).toBe("あいう");

    const undone = historyReducer(typed, { type: "undo" });
    expect(getNode(undone.present.nodes, id)?.text).toBe("A");
  });

  it("編集セッションが切れると別の履歴になる", () => {
    const state = setup("A");
    const id = findByText(state.present.nodes, "A").id;
    const typed = run(
      state,
      { type: "updateText", id, text: "あ" },
      { type: "stopEditing" },
      { type: "startEditing", id },
      { type: "updateText", id, text: "あい" },
    );
    expect(typed.past).toHaveLength(2);
    expect(getNode(historyReducer(typed, { type: "undo" }).present.nodes, id)?.text).toBe("あ");
  });

  it("Undo 後に新しい操作をすると Redo は捨てられる", () => {
    const undone = run(setup(), { type: "createChild" }, { type: "undo" });
    expect(canRedo(undone)).toBe(true);
    const next = historyReducer(undone, { type: "createSibling" });
    expect(canRedo(next)).toBe(false);
  });

  it("Undo / Redo 直後は編集モードを抜ける", () => {
    const created = historyReducer(setup(), { type: "createChild" });
    expect(created.present.editingId).not.toBeNull();
    expect(historyReducer(created, { type: "undo" }).present.editingId).toBeNull();
  });

  it("同じノードを続けて動かしても履歴は1件にまとまる", () => {
    const state = setup("A");
    const id = findByText(state.present.nodes, "A").id;
    const dragged = run(
      state,
      { type: "moveNode", id, x: 10, y: 0 },
      { type: "moveNode", id, x: 20, y: 0 },
      { type: "moveNode", id, x: 30, y: 0 },
    );
    expect(dragged.past).toHaveLength(1);
    expect(getNode(historyReducer(dragged, { type: "undo" }).present.nodes, id)?.x).toBe(
      findByText(state.present.nodes, "A").x,
    );
  });

  it("履歴は HISTORY_LIMIT 件で打ち切られ、古いほうから捨てられる", () => {
    let state = setup("A");
    const ids = ["A", "B"].map((text) => findByText(state.present.nodes, text).id);
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      // 対象ノードを交互に変えて、まとめ処理が効かないようにする
      state = historyReducer(state, { type: "moveNode", id: ids[i % 2], x: i + 1, y: 0 });
    }
    expect(state.past).toHaveLength(HISTORY_LIMIT);
  });

  it("空の履歴に対する Undo / Redo は何もしない", () => {
    const state = setup();
    expect(historyReducer(state, { type: "undo" })).toBe(state);
    expect(historyReducer(state, { type: "redo" })).toBe(state);
  });

  it("reset は履歴を消して作り直す", () => {
    const created = historyReducer(setup(), { type: "createChild" });
    const other = layoutTree(buildTree({ text: "other" }));
    const reset = historyReducer(created, { type: "reset", nodes: other });
    expect(canUndo(reset)).toBe(false);
    expect(canRedo(reset)).toBe(false);
    expect(reset.present.nodes).toBe(other);
  });
});
