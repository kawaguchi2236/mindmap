"use client";

/**
 * エディタのキーボード操作（CLAUDE.md §8）。
 *
 * - window の bubble フェーズで拾う。テキスト編集中のキーは入力欄側で
 *   stopPropagation しているのでここには届かない。加えて二重に、
 *   入力要素が対象のときと editingId がある間は何もしない。
 * - macOS / Windows 双方で動くよう修飾キーは metaKey || ctrlKey で判定する。
 * - 日本語入力の変換確定 Enter を拾わないよう isComposing を見る。
 */
import { useEffect, type Dispatch, type RefObject } from "react";
import { track } from "@/features/telemetry";
import { copySubtree, type ClipboardPayload } from "./clipboard";
import type { HistoryAction } from "./history";
import type { EditorState } from "./reducer";

const ARROW_DIRECTIONS = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
} as const;

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export interface UseKeyboardOptions {
  state: EditorState;
  dispatch: Dispatch<HistoryAction>;
  /** コピーした部分木の置き場。Undo で巻き戻らないよう ref で持つ。 */
  clipboardRef: RefObject<ClipboardPayload | null>;
  enabled?: boolean;
}

export function useKeyboard({
  state,
  dispatch,
  clipboardRef,
  enabled = true,
}: UseKeyboardOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.isComposing) return;
      if (isTextEntryTarget(event.target)) return;

      // テキスト編集中に効いてよいのは Esc だけ（入力欄が拾えなかった場合の保険）。
      if (state.editingId !== null) {
        if (event.key === "Escape") {
          event.preventDefault();
          dispatch({ type: "stopEditing" });
        }
        return;
      }

      const mod = event.metaKey || event.ctrlKey;

      if (mod) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          dispatch(event.shiftKey ? { type: "redo" } : { type: "undo" });
          return;
        }
        if (key === "y") {
          // Windows の慣習的な Redo。
          event.preventDefault();
          dispatch({ type: "redo" });
          return;
        }
        if (key === "c") {
          event.preventDefault();
          clipboardRef.current = copySubtree(state.nodes, state.selectedId);
          return;
        }
        if (key === "v") {
          event.preventDefault();
          const clipboard = clipboardRef.current;
          if (clipboard) dispatch({ type: "paste", clipboard });
          return;
        }
        return;
      }

      switch (event.key) {
        case "Enter":
          event.preventDefault();
          dispatch({ type: "createSibling" });
          track("node_created");
          return;
        case "Tab":
          event.preventDefault();
          dispatch(event.shiftKey ? { type: "outdent" } : { type: "createChild" });
          if (!event.shiftKey) track("node_created");
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault(); // Backspace によるブラウザバックを止める
          dispatch({ type: "deleteNode" });
          return;
        case "Escape":
          event.preventDefault();
          dispatch({ type: "select", id: null });
          return;
        case "F2":
          event.preventDefault();
          dispatch({ type: "startEditing" });
          return;
        case " ":
          if (state.selectedId) {
            event.preventDefault();
            dispatch({ type: "toggleCollapse" });
          }
          return;
        default:
          break;
      }

      const direction = ARROW_DIRECTIONS[event.key as keyof typeof ARROW_DIRECTIONS];
      if (direction) {
        event.preventDefault();
        dispatch({ type: "navigate", direction });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state, dispatch, clipboardRef, enabled]);
}
