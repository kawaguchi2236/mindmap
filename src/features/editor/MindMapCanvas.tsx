"use client";

/**
 * React Flow をキャンバスとして使うマインドマップ表示。
 *
 * 役割分担（CLAUDE.md §37: 自前で書かずに済むものは書かない）:
 * - パン・ズーム・ドラッグ・エッジ描画  → React Flow
 * - ツリーレイアウト・キーボード・Undo  → 自前（layout.ts / reducer.ts / history.ts）
 *
 * React Flow 自身のキーボード操作は無効化して、useKeyboard と衝突させない。
 *
 * 見た目は design/ハンドオフ.md `#2b`（Press）に合わせる。要点:
 * - ヘッダーバーを持たない。クロームは四隅に浮かべ、キャンバスを全面で使う。
 * - ノードは枠なし。階層ごとの文字サイズだけで構造を見せる。
 * - 常設ツールバーを持たず、選択中のノードにだけ道具を出す。
 * - 広告は絶対に置かない（CLAUDE.md §15）。
 *
 * 四隅のクロームを React Flow の <Panel> で出しているのは、Panel が
 * `.react-flow__viewport` の**外側**に描かれるため。PNG 書き出しは
 * viewport を複製するので、Panel の中身は書き出し画像に写らない
 * （src/features/export/exportPng.ts）。同じ理由でトンボも viewport の外に置く。
 */
import {
  Background,
  BackgroundVariant,
  Handle,
  NodeToolbar,
  Panel,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
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
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import type { ID } from "@/lib/model/types";
import { Icon } from "@/components/ui";
import {
  mergePreservingMeasured,
  toFlowEdges,
  toFlowNodes,
  type MindMapFlowNode,
} from "./flowNodes";
import type { HistoryAction } from "./history";
import { nodeBox, tierOf } from "./layout";
import type { EditorState } from "./reducer";
import { ExportPngButton } from "@/features/export";
import { track } from "@/features/telemetry";
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
      track("node_created");
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "stopEditing" });
      dispatch(event.shiftKey ? { type: "outdent", id } : { type: "createChild", id });
      if (!event.shiftKey) track("node_created");
      return;
    }
    // Backspace を含む残りのキーは入力欄のローカルな編集として処理させる。
    event.stopPropagation();
  };

  const tier = tierOf(data.depth);
  /*
   * 幅の指定が2種類あるのは、枠なしのノードで「選択の下線」と「接続線の始点」を
   * 両立させるため。
   * - 通常時は max-content でテキストにぴたりと合わせる（下線がテキスト幅になる）。
   * - 編集中だけ見積もり幅を与える。入力欄は max-content にできないため。
   * どちらの場合も折り返しは max-width で止まり、レイアウトの行数見積もりと一致する。
   */
  const style: CSSProperties & Record<"--node-line-height", string> = {
    fontSize: `${tier.fontSize}px`,
    "--node-line-height": `${tier.lineHeight}px`,
    maxWidth: data.maxWidth,
    width: data.editing ? data.width : "max-content",
  };

  return (
    <div
      className="mindmap-node"
      data-tier={Math.min(data.depth, 2)}
      data-selected={data.selected || undefined}
      data-root={data.isRoot || undefined}
      data-editing={data.editing || undefined}
      style={style}
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
          rows={data.lines}
          onChange={(event) => dispatch({ type: "updateText", id, text: event.target.value })}
          onKeyDown={onKeyDown}
          onBlur={() => dispatch({ type: "stopEditing" })}
          aria-label="ノードのテキスト"
        />
      ) : (
        <span className="mindmap-node__text">{data.text || "（無題）"}</span>
      )}
      {/* ルートの下に出す `ROOT · N NODES`。絶対配置なのでノードの高さを変えない。 */}
      {data.rootMeta !== null && <span className="mindmap-node__meta">{data.rootMeta}</span>}
      {/* 折りたたみ中だけ子数のバッジを出す（ハンドオフ #2b）。
          展開中は何も出さない ＝ キャンバスに常設の道具を置かない。 */}
      {data.collapsed && data.childCount > 0 && (
        <button
          type="button"
          className="mindmap-node__badge"
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "toggleCollapse", id });
          }}
          aria-label="子ノードを開く"
          aria-expanded={false}
          tabIndex={-1}
        >
          {data.childCount}
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

/**
 * 選択中のノードに浮かぶコンテキストツールバー（ハンドオフ #2b）。
 *
 * NodeToolbar は `.react-flow__renderer` へ portal されるので、ズームで
 * 拡大されず、PNG 書き出しにも写らない。
 */
function ContextToolbar({
  nodeId,
  isRoot,
  dispatch,
}: {
  nodeId: ID;
  isRoot: boolean;
  dispatch: Dispatch<HistoryAction>;
}): ReactElement {
  return (
    <NodeToolbar
      nodeId={nodeId}
      isVisible
      position={Position.Top}
      align="start"
      offset={14}
      className="mindmap-toolbar"
    >
      <span className="mindmap-toolbar__label">SELECTED</span>
      <span className="mindmap-toolbar__rule" aria-hidden="true" />
      <button
        type="button"
        className="mindmap-toolbar__button"
        data-accent="true"
        title="子ノードを追加（Tab）"
        onClick={() => {
          dispatch({ type: "createChild", id: nodeId });
          track("node_created");
        }}
      >
        <Icon name="plus" size={15} />
        <span className="mindmap-visually-hidden">子ノードを追加</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar__button"
        title="テキストを編集（F2）"
        onClick={() => dispatch({ type: "startEditing", id: nodeId })}
      >
        <Icon name="text" size={15} />
        <span className="mindmap-visually-hidden">テキストを編集</span>
      </button>
      <button
        type="button"
        className="mindmap-toolbar__button"
        title="折りたたむ／開く（Space）"
        onClick={() => dispatch({ type: "toggleCollapse", id: nodeId })}
      >
        <Icon name="collapse" size={15} />
        <span className="mindmap-visually-hidden">折りたたむ</span>
      </button>
      {/* ルートは削除できない（マップに1つだけ）ので、道具自体を出さない。 */}
      {!isRoot && (
        <button
          type="button"
          className="mindmap-toolbar__button"
          title="削除（Delete）"
          onClick={() => dispatch({ type: "deleteNode", id: nodeId })}
        >
          <Icon name="trash" size={15} />
          <span className="mindmap-visually-hidden">削除</span>
        </button>
      )}
    </NodeToolbar>
  );
}

/**
 * キャンバス四隅のトンボ（ハンドオフ「罫線の作法」）。
 *
 * SVG の d はパーセント指定ができず、コンテナの大きさに追従させられないので
 * 14px の L 字は CSS の border で描く。
 */
function CropMarks(): ReactElement {
  return (
    <div className="mindmap-crop" aria-hidden="true">
      <span data-corner="tl" />
      <span data-corner="tr" />
      <span data-corner="bl" />
      <span data-corner="br" />
    </div>
  );
}

export interface MindMapCanvasProps {
  state: EditorState;
  dispatch: Dispatch<HistoryAction>;
  /** PNG の保存ファイル名に使う。左上のマップ名にもなる。 */
  title?: string;
  /** 左上に出す保存・同期状態の短い文（mono）。空文字なら出さない。 */
  status?: ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
}

export function MindMapCanvas({
  state,
  dispatch,
  title,
  status,
  canUndo = false,
  canRedo = false,
}: MindMapCanvasProps): ReactElement {
  const { setCenter, zoomIn, zoomOut } = useReactFlow<MindMapFlowNode>();
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
      toFlowNodes(visibleNodes, {
        selectedId,
        editingId,
        childCounts,
        totalCount: modelNodes.length,
      }),
    [visibleNodes, selectedId, editingId, childCounts, modelNodes.length],
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
      const box = nodeBox(root.text, 0);
      setCenter(root.x + box.width / 2, root.y + box.height / 2, { zoom: 1, duration });
    },
    [modelNodes, setCenter],
  );

  /*
   * 初回のセンタリングはキャンバスの寸法が確定してから行う。
   *
   * 以前は useNodesInitialized() を条件にしていたが、これはノードが実測
   * （measured）されるまで true にならない。このエディタは固定寸法を
   * initialWidth / initialHeight と handles で与えて実測を待たない作りにして
   * あるため measured が入らず、条件が永久に false のままで初回センタリングが
   * 一度も走らなかった（ルートが画面左上に出る）。
   *
   * setCenter が必要とするのはストアが持つキャンバスの幅と高さだけなので、
   * それが確定したかどうかだけを見る。
   * duration 0 で動かすのは、非表示タブでは requestAnimationFrame が止まり
   * アニメーション付きの遷移が完了しないため。
   */
  const canvasReady = useStore((s) => s.width > 0 && s.height > 0);
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current || !canvasReady || modelNodes.length === 0) return;
    centeredRef.current = true;
    recenter(0);
  }, [canvasReady, modelNodes, recenter]);

  /*
   * ⌘/Ctrl + 0 で中央へ戻る（ハンドオフのキーボード表。左下のヒントに出す）。
   * 中央へ戻す処理はビューポートを持つ React Flow 側にしかないので、
   * useKeyboard（モデル操作のみ）ではなくここで拾う。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "0") return;
      event.preventDefault();
      recenter();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [recenter]);

  const zoomPercent = useStore((s) => Math.round(s.transform[2] * 100));
  const selected = selectedId === null ? null : modelNodes.find((node) => node.id === selectedId);

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
          // 四隅はデザインのクロームで使うので、帰属表示は下中央に置く。
          attributionPosition="bottom-center"
        >
          {/*
           * ドットグリッドはダークだけ（`--color-canvas-dot` がライトでは
           * transparent）。ライトは紙一色で、構造は罫線と余白だけで出す。
           */}
          <Background
            variant={BackgroundVariant.Dots}
            gap={30}
            size={1}
            color="var(--color-canvas-dot)"
          />

          {/* --- 左上: マップ名と状態 ------------------------------------ */}
          <Panel position="top-left" className="mindmap-chrome mindmap-chrome--identity">
            <span className="mindmap-chrome__mark" aria-hidden="true" />
            <span className="mindmap-chrome__title">{title || "無題のマップ"}</span>
            {status ? <span className="mindmap-chrome__status">{status}</span> : null}
          </Panel>

          {/* --- 右上: 履歴と書き出し ------------------------------------ */}
          <Panel position="top-right" className="mindmap-chrome mindmap-chrome--actions">
            <button
              type="button"
              className="mindmap-chrome__action"
              onClick={() => dispatch({ type: "undo" })}
              disabled={!canUndo}
            >
              元に戻す
            </button>
            <button
              type="button"
              className="mindmap-chrome__action"
              onClick={() => dispatch({ type: "redo" })}
              disabled={!canRedo}
            >
              やり直す
            </button>
            {/* 書き出しは担当 B の実装。ReactFlowProvider の内側でだけ動く。 */}
            <ExportPngButton title={title} className="mindmap-chrome__action" />
            {/*
             * ハンドオフ #2b の右上はアバター（アカウント）。Phase 1 のエディタに
             * アカウントメニューは無いので、同じ位置を設定への導線にする。
             * ダークモードの切替もそこにある。
             */}
            <Link className="mindmap-chrome__action" href="/settings">
              設定
            </Link>
          </Panel>

          {/* --- 左下: ショートカットのヒント --------------------------- */}
          <Panel position="bottom-left" className="mindmap-chrome mindmap-chrome--hints">
            <span>Tab 子ノード</span>
            <span>Enter 同階層</span>
            <span>⌘0 中央へ</span>
          </Panel>

          {/* --- 右下: 倍率とキャンバス操作 ----------------------------- */}
          <Panel position="bottom-right" className="mindmap-chrome mindmap-chrome--view">
            <span className="mindmap-chrome__zoom">{zoomPercent}%</span>
            <button
              type="button"
              className="mindmap-chrome__icon"
              onClick={() => zoomOut()}
              aria-label="縮小"
            >
              <Icon name="minus" size={14} />
            </button>
            <button
              type="button"
              className="mindmap-chrome__icon"
              onClick={() => zoomIn()}
              aria-label="拡大"
            >
              <Icon name="plus" size={14} />
            </button>
            <button
              type="button"
              className="mindmap-chrome__icon"
              onClick={() => recenter()}
              aria-label="中央へ戻る"
              title="中央へ戻る（⌘0）"
            >
              <Icon name="recenter" size={14} />
            </button>
            <button
              type="button"
              className="mindmap-chrome__action"
              onClick={() => dispatch({ type: "relayout" })}
            >
              整列
            </button>
          </Panel>

          {/* 選択中だけ道具を出す。編集中は入力の邪魔になるので出さない。 */}
          {selected && editingId === null && (
            <ContextToolbar
              nodeId={selected.id}
              isRoot={selected.parentId === null}
              dispatch={dispatch}
            />
          )}
        </ReactFlow>
        <CropMarks />
      </div>
    </DispatchContext.Provider>
  );
}
