/**
 * Undo/Redo。editorReducer をラップしたスナップショット方式。
 *
 * 方針:
 * - ノードを変えないアクション（選択・編集開始/終了・矢印移動）は履歴を積まない。
 * - テキスト入力は1文字ごとに積まない。同じノードへの連続した updateText は
 *   1つの編集セッションとみなし、最初の1打鍵のときだけ「編集前」を積む。
 *   途中で選択や編集終了が挟まるとセッションは切れる。
 * - スナップショットは最大 HISTORY_LIMIT 件（超えた分は古いほうから捨てる）。
 *   1マップ最大 1000 ノード × 50 件でも数 MB 程度に収まる。
 */
import { editorReducer, isUndoable, type EditorAction, type EditorState } from "./reducer";

export const HISTORY_LIMIT = 50;

export interface HistoryState {
  present: EditorState;
  past: EditorState[];
  future: EditorState[];
  /** 直前に履歴を積んだアクションの合成キー。連続入力をまとめるために使う。 */
  lastCommit: string | null;
}

export type HistoryAction = EditorAction | { type: "undo" } | { type: "redo" };

export function createHistoryState(present: EditorState): HistoryState {
  return { present, past: [], future: [], lastCommit: null };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

/** 同じキーのアクションが連続する間は履歴を積み増さない。null は必ず積む。 */
function coalesceKey(action: EditorAction): string | null {
  switch (action.type) {
    case "updateText":
      return `updateText:${action.id}`;
    case "moveNode":
      return `moveNode:${action.id}`;
    default:
      return null;
  }
}

/** Undo/Redo 直後は編集モードを抜ける（消えたノードの入力欄が復活しないように）。 */
function withoutEditing(state: EditorState): EditorState {
  return state.editingId === null ? state : { ...state, editingId: null };
}

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "undo") {
    if (state.past.length === 0) return state;
    const previous = state.past[state.past.length - 1];
    return {
      present: withoutEditing(previous),
      past: state.past.slice(0, -1),
      future: [state.present, ...state.future],
      lastCommit: null,
    };
  }

  if (action.type === "redo") {
    if (state.future.length === 0) return state;
    const [next, ...rest] = state.future;
    return {
      present: withoutEditing(next),
      past: [...state.past, state.present],
      future: rest,
      lastCommit: null,
    };
  }

  if (action.type === "reset") {
    return createHistoryState(editorReducer(state.present, action));
  }

  const present = editorReducer(state.present, action);
  if (present === state.present) return state;

  if (!isUndoable(action)) {
    return { ...state, present, lastCommit: null };
  }

  const key = coalesceKey(action);
  if (key !== null && key === state.lastCommit) {
    // 同じ編集セッションの続き。履歴は増やさず現在状態だけ進める。
    return { ...state, present };
  }

  const past = [...state.past, state.present];
  return {
    present,
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
    lastCommit: key,
  };
}
