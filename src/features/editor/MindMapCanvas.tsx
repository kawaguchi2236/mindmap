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
  useReactFlow,
  type Edge,
  type Node,
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
  type Dispatch,
  type ReactElement,
} from "react";
import type { ID } from "@/lib/model/types";
import type { HistoryAction } from "./history";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout";
import type { EditorState } from "./reducer";
import { getRoot, getVisibleNodes } from "./tree";

interface MindMapNodeData extends Record<string, unknown> {
  text: string;
  editing: boolean;
  selected: boolean;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
}

type MindMapFlowNode = Node<MindMapNodeData, "mindmap">;

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
  const { setCenter, setNodes, setEdges } = useReactFlow<MindMapFlowNode>();
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
    () =>
      visibleNodes.map((node) => ({
        id: node.id,
        type: "mindmap" as const,
        position: { x: node.x, y: node.y },
        // 編集中はドラッグを止めないとテキスト選択ができない。
        draggable: node.id !== editingId,
        selectable: true,
        data: {
          text: node.text,
          editing: node.id === editingId,
          selected: node.id === selectedId,
          isRoot: node.parentId === null,
          collapsed: node.collapsed,
          childCount: childCounts.get(node.id) ?? 0,
        },
      })),
    [visibleNodes, selectedId, editingId, childCounts],
  );

  /**
   * React Flow は非 controlled で使い、reducer の内容を setNodes / setEdges で
   * 流し込む。ドラッグ中の追従は React Flow の内部 store に任せ、確定した座標
   * だけを moveNode で reducer へ戻す（同じ状態を二重に持たないため）。
   */
  useEffect(() => {
    setNodes(derivedNodes);
  }, [derivedNodes, setNodes]);

  const edges = useMemo<Edge[]>(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    return visibleNodes
      .filter((node) => node.parentId !== null && visibleIds.has(node.parentId))
      .map((node) => ({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId as string,
        target: node.id,
        type: "bezier",
      }));
  }, [visibleNodes]);

  useEffect(() => {
    setEdges(edges);
  }, [edges, setEdges]);

  const recenter = useCallback(() => {
    const root = getRoot(modelNodes);
    if (!root) return;
    setCenter(root.x + NODE_WIDTH / 2, root.y + NODE_HEIGHT / 2, { zoom: 1, duration: 300 });
  }, [modelNodes, setCenter]);

  // 初回表示でルートを中央に置く。
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || modelNodes.length === 0) return;
    centeredRef.current = true;
    recenter();
  }, [modelNodes, recenter]);

  return (
    <DispatchContext.Provider value={dispatch}>
      <div className="mindmap-canvas">
        <ReactFlow<MindMapFlowNode>
          defaultNodes={derivedNodes}
          defaultEdges={edges}
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
              <button type="button" onClick={recenter}>
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
