"use client";

/**
 * エディタの統合入口。
 *
 * 責務はノードの編集だけ。保存は呼び出し側が onChange を受けて行う。
 * このコンポーネントから IndexedDB やネットワークには触れない（CLAUDE.md §5）。
 */
import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useReducer, useRef, type ReactElement, type ReactNode } from "react";
import type { MindMapDocument } from "@/lib/model/types";
import type { ClipboardPayload } from "./clipboard";
import { canRedo, canUndo, createHistoryState, historyReducer } from "./history";
import { MindMapCanvas } from "./MindMapCanvas";
/*
 * editor.css は React Flow 自身のスタイル（MindMapCanvas が読む
 * `@xyflow/react/dist/style.css`）より**後**に読ませる。import の評価順が
 * そのまま CSS の順序になるため、ここが先だと React Flow 側の指定に負ける。
 */
import "./editor.css";
import { trackMapEdited } from "@/features/telemetry";
import { createInitialState } from "./reducer";
import { useKeyboard } from "./useKeyboard";

export interface MindMapEditorProps {
  document: MindMapDocument;
  /**
   * 内容が変わるたびに呼ばれる。
   * 渡される document の map は入力そのまま（updatedAt と version は
   * 永続化層が進める契約なのでここでは触らない）。
   */
  onChange: (document: MindMapDocument) => void;
  /**
   * 左上に出す保存・同期状態の短い文。
   *
   * 文言を決めるのは永続化の状態を持つ呼び出し側（src/app/page.tsx）。
   * エディタは表示位置だけを知っている。
   */
  status?: ReactNode;
}

export function MindMapEditor({
  document: doc,
  onChange,
  status,
}: MindMapEditorProps): ReactElement {
  const [state, dispatch] = useReducer(historyReducer, doc.nodes, (nodes) =>
    createHistoryState(createInitialState(nodes)),
  );
  const clipboardRef = useRef<ClipboardPayload | null>(null);

  // 効果の依存に入れずに最新値を参照するための ref。
  // 先に宣言した効果から順に実行されるので、下の効果はここで同期した値を読める。
  const docRef = useRef(doc);
  const onChangeRef = useRef(onChange);
  const lastEmittedRef = useRef(doc.nodes);
  useEffect(() => {
    docRef.current = doc;
    onChangeRef.current = onChange;
  });

  useKeyboard({ state: state.present, dispatch, clipboardRef });

  // マップが切り替わったら状態と履歴を作り直す。
  const mapId = doc.map.id;
  const loadedMapIdRef = useRef(mapId);
  useEffect(() => {
    if (loadedMapIdRef.current === mapId) return;
    loadedMapIdRef.current = mapId;
    clipboardRef.current = null;
    lastEmittedRef.current = docRef.current.nodes;
    dispatch({ type: "reset", nodes: docRef.current.nodes });
  }, [mapId]);

  // ノードが変わったときだけ親へ通知する（選択・編集状態の変化では呼ばない）。
  const nodes = state.present.nodes;
  useEffect(() => {
    if (nodes === lastEmittedRef.current) return;
    lastEmittedRef.current = nodes;
    // 打鍵ごとに呼んでよい。間引きは telemetry 側で行う（CLAUDE.md §31）。
    trackMapEdited();
    onChangeRef.current({ ...docRef.current, nodes });
  }, [nodes]);

  return (
    <div className="mindmap-editor">
      <ReactFlowProvider>
        <MindMapCanvas
          state={state.present}
          dispatch={dispatch}
          title={doc.map.title}
          status={status}
          canUndo={canUndo(state)}
          canRedo={canRedo(state)}
        />
      </ReactFlowProvider>
    </div>
  );
}
