"use client";

/**
 * React Flow をキャンバスとして使うマインドマップ表示。
 *
 * 役割分担（CLAUDE.md §37: 自前で書かずに済むものは書かない）:
 * - パン・ズーム・ドラッグ・エッジ描画  → React Flow
 * - ツリーレイアウト・キーボード・Undo  → 自前（layout.ts / reducer.ts / history.ts）
 *
 * React Flow 自身のキーボード操作は無効化して、useKeyboard と衝突させない。
 */
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
} from "react";
import type { ID } from "@/lib/model/types";
import {
  mergePreservingMeasured,
  toFlowEdges,
  toFlowNodes,
  type MindMapFlowNode,
} from "./flowNodes";
import type { HistoryAction } from "./history";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";
import type { EditorState } from "./reducer";
import { getRoot, getVisibleNodes } from "./tree";

/**
 * dispatch をノードの data に入れるとノードごとに毎回別参照になるため、
 * context 経由で渡す。
 */
const DispatchContext = createContext<Dispatch<HistoryAction> | null>(null);

function useDispatch(): Dispatch<HistoryAction> {
  const dispatch = useContext(DispatchContext);
  if (!dispatch) throw new Error("MindMapCanvas の外で dispatch が使われました");
  return dispatch;
}

const hiddenHandleStyle = { opacity: 0, pointerEvents: "none" as const };

function MindMapNodeView({ id, data }: NodeProps<MindMapFlowNode>): ReactElement {
  const dispatch = useDispatch();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!data.editing) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    if (document.activeElement === textarea) return;
    /*
     * visibility: hidden の要素はフォーカスを受け付けない。採寸前などで
     * 弾かれたときのために、次のフレームで一度だけやり直す。
     */
    const retry = requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });
    return () => cancelAnimationFrame(retry);
  }, [data.editing]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "stopEditing" });
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // 編集を確定して次の兄弟へ。Shift+Enter は改行。
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "stopEditing" });
      dispatch({ type: "createSibling", id });
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "stopEditing" });
      dispatch(event.shiftKey ? { type: "outdent", id } : { type: "createChild", id });
      return;
    }
    // Backspace を含む残りのキーは入力欄のローカルな編集として処理させる。
    event.stopPropagation();
  };

  return (
    <div
      className="mindmap-node"
      data-selected={data.selected || undefined}
      data-root={data.isRoot || undefined}
      style={{ width: NODE_WIDTH, minHeight: NODE_HEIGHT }}
    >
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        style={hiddenHandleStyle}
      />
      {data.editing ? (
        <textarea
          ref={textareaRef}
          className="mindmap-node__input"
          value={data.text}
          rows={1}
          onChange={(event) => dispatch({ type: "updateText", id, text: event.target.value })}
          onKeyDown={onKeyDown}
          onBlur={() => dispatch({ type: "stopEditing" })}
          aria-label="ノードのテキスト"
        />
      ) : (
        <span className="mindmap-node__text">{data.text || "（無題）"}</span>
      )}
      {data.childCount > 0 && (
        <button
          type="button"
          className="mindmap-node__toggle"
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "toggleCollapse", id });
          }}
          aria-label={data.collapsed ? "子ノードを開く" : "子ノードを閉じる"}
          aria-expanded={!data.collapsed}
          tabIndex={-1}
        >
          {data.collapsed ? data.childCount : "−"}
        </button>
      )}
      <Handle
        type="source"
        position={Position.Right}
        isConnectable={false}
        style={hiddenHandleStyle}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { mindmap: MindMapNodeView };

export interface MindMapCanvasProps {
  state: EditorState;
  dispatch: Dispatch<HistoryAction>;
}

export function MindMapCanvas({ state, dispatch }: MindMapCanvasProps): ReactElement {
  const { setCenter } = useReactFlow<MindMapFlowNode>();
  const { nodes: modelNodes, selectedId, editingId } = state;

  const childCounts = useMemo(() => {
    const counts = new Map<ID, number>();
    for (const node of modelNodes) {
      if (node.parentId === null) continue;
      counts.set(node.parentId, (counts.get(node.parentId) ?? 0) + 1);
    }
    return counts;
  }, [modelNodes]);

  const visibleNodes = useMemo(() => getVisibleNodes(modelNodes), [modelNodes]);

  const derivedNodes = useMemo<MindMapFlowNode[]>(
    () => toFlowNodes(visibleNodes, { selectedId, editingId, childCounts }),
    [visibleNodes, selectedId, editingId, childCounts],
  );
  const derivedEdges = useMemo<Edge[]>(() => toFlowEdges(visibleNodes), [visibleNodes]);

  /**
   * React Flow は controlled で使う。onNodesChange は採寸結果（dimensions）と
   * ドラッグ中の座標を受け取る唯一の口なので必ず繋ぐこと。
   * 位置と構造の正は reducer 側にあり、ドラッグで確定した座標だけを
   * onNodeDragStop から moveNode で戻す。
   */
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<MindMapFlowNode>(derivedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(derivedEdges);

  // props 由来の値を state へ同期するのは render 中に行う（React 公式の推奨手順）。
  // effect でやると同期前の状態が一度描画され、ノードがちらつく。
  const [syncedNodes, setSyncedNodes] = useState(derivedNodes);
  if (syncedNodes !== derivedNodes) {
    setSyncedNodes(derivedNodes);
    setRfNodes((previous) => mergePreservingMeasured(previous, derivedNodes));
  }
  const [syncedEdges, setSyncedEdges] = useState(derivedEdges);
  if (syncedEdges !== derivedEdges) {
    setSyncedEdges(derivedEdges);
    setRfEdges(derivedEdges);
  }

  const recenter = useCallback(
    (duration = 300) => {
      const root = getRoot(modelNodes);
      if (!root) return;
      setCenter(root.x + NODE_WIDTH / 2, root.y + NODE_HEIGHT / 2, { zoom: 1, duration });
    },
    [modelNodes, setCenter],
  );

  /*
   * 初回のセンタリングは採寸が終わってから。採寸前だとキャンバスの大きさが
   * 確定しておらず、ルートが画面左上に寄ってしまう。
   */
  const nodesInitialized = useNodesInitialized();
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || !nodesInitialized) return;
    centeredRef.current = true;
    recenter(0);
  }, [nodesInitialized, recenter]);

  return (
    <DispatchContext.Provider value={dispatch}>
      <div className="mindmap-canvas">
        <ReactFlow<MindMapFlowNode>
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeDragStop={(_event, node) =>
            dispatch({ type: "moveNode", id: node.id, x: node.position.x, y: node.position.y })
          }
          onNodeClick={(_event, node) => dispatch({ type: "select", id: node.id })}
          onNodeDoubleClick={(_event, node) => dispatch({ type: "startEditing", id: node.id })}
          onPaneClick={() => dispatch({ type: "select", id: null })}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          // React Flow 組み込みのキー操作は無効化し、useKeyboard に一本化する。
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <Controls showInteractive={false} position="bottom-left" />
          <Panel position="bottom-right">
            <div className="mindmap-canvas__actions">
              <button type="button" onClick={() => recenter()}>
                中央へ戻る
              </button>
              <button type="button" onClick={() => dispatch({ type: "relayout" })}>
                自動整列
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
    </DispatchContext.Provider>
  );
}
