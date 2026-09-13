/**
 * モデル（MindMapNode[]）から React Flow に渡すノード／エッジを作る純関数。
 *
 * DOM に触らないのでテストできる。ここを薄く保つ理由は、React Flow の
 * 「採寸できていないノードは visibility: hidden にする」挙動にあわせて
 * measured を持ち回す必要があるため（mergePreservingMeasured 参照）。
 */
import { Position, type Edge, type Node, type NodeHandle } from "@xyflow/react";
import type { ID, MindMapNode } from "@/lib/model/types";
import { estimateNodeHeight, NODE_WIDTH } from "./layout";

export interface MindMapNodeData extends Record<string, unknown> {
  text: string;
  editing: boolean;
  selected: boolean;
  isRoot: boolean;
  collapsed: boolean;
  childCount: number;
}

export type MindMapFlowNode = Node<MindMapNodeData, "mindmap">;

/*
 * ノードのハンドル（エッジの接続点）を実測に頼らず明示する。
 *
 * React Flow はエッジの端点を internals.handleBounds から決めるが、
 * handleBounds は「ユーザーノードに measured がある」か「handles を自分で
 * 宣言している」かのどちらかでしか作られない（system の parseHandles）。
 * initialWidth/initialHeight は寸法は与えるが measured ではないため、
 * 実測が届くまで handleBounds は undefined のままで、エッジが1本も描かれない
 * （リロード直後に全ノードが未採寸で現れるとこの状態になる）。
 *
 * レイアウトを固定寸法で組んでいる以上、接続点も固定で決まる。宣言しておけば
 * 採寸の有無に関わらず必ずエッジが出る。x/y はノード左上からの相対座標で、
 * 端点は getHandlePosition により Left なら (x, y + height/2)、
 * Right なら (x + width, y + height/2) になる。
 */
const HANDLE_SIZE = 1;

/**
 * ノードの高さは文字数で変わるので、ハンドルも高さに合わせて作る。
 * ここがノード中心からずれると接続線が斜めにずれる。
 */
function handlesFor(height: number): NodeHandle[] {
  const centerY = height / 2 - HANDLE_SIZE / 2;
  return [
    {
      type: "target",
      position: Position.Left,
      x: 0,
      y: centerY,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    },
    {
      type: "source",
      position: Position.Right,
      x: NODE_WIDTH - HANDLE_SIZE,
      y: centerY,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
    },
  ];
}

export interface FlowNodeOptions {
  selectedId: ID | null;
  editingId: ID | null;
  childCounts: Map<ID, number>;
}

/** 表示対象のモデルノードを React Flow のノードへ変換する。 */
export function toFlowNodes(
  visibleNodes: MindMapNode[],
  { selectedId, editingId, childCounts }: FlowNodeOptions,
): MindMapFlowNode[] {
  return visibleNodes.map((node) => {
    const height = estimateNodeHeight(node.text);
    return {
      id: node.id,
      type: "mindmap" as const,
      position: { x: node.x, y: node.y },
      /*
       * 採寸が終わるまで React Flow はノードを visibility: hidden で描く。
       * 追加直後のノードがこれに当たると、即編集モードで出したはずの textarea が
       * hidden を継承してフォーカスを受け付けず、文字が打てなくなる。
       * レイアウトは元々この固定寸法で計算しているので、同じ値を先に渡しておく。
       * 実測が届けばそちらで上書きされる（nodeHasDimensions は measured を優先）。
       */
      initialWidth: NODE_WIDTH,
      initialHeight: height,
      handles: handlesFor(height),
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
    };
  });
}

/** 親子エッジ。両端が表示されているものだけ描く。 */
export function toFlowEdges(visibleNodes: MindMapNode[]): Edge[] {
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  return visibleNodes
    .filter((node) => node.parentId !== null && visibleIds.has(node.parentId))
    .map((node) => ({
      id: `${node.parentId}->${node.id}`,
      source: node.parentId as string,
      target: node.id,
      // 型は指定しない。React Flow v12 の既定が "default"（ベジェ）。
      // "bezier" という型名は存在せず、指定すると毎レンダー警告が出て
      // 本当のエラーがコンソールに埋もれる。
    }));
}

/**
 * 新しく作ったノード配列に、前回ぶんの `measured`（React Flow が実測した寸法）を
 * 引き継ぐ。
 *
 * これが無いと画面からノードが消える。React Flow は内部ノードの measured を
 * 「ユーザーが渡したノードの measured」からしか作らない（adoptUserNodes）。
 * measured の無いノードを渡すと未採寸とみなされ visibility: hidden で描画される。
 * さらに DOM 要素の寸法自体は変わっていないため ResizeObserver が再発火せず、
 * measured は二度と戻らない。= 一度でも落とすと恒久的に消える。
 *
 * measured は onNodesChange（type: "dimensions"）経由で React Flow から受け取り、
 * applyNodeChanges がノードに書き込む。ここではそれを保存するだけ。
 * 位置と data の正はあくまで reducer 側なので next の値で上書きする。
 */
export function mergePreservingMeasured(
  previous: MindMapFlowNode[],
  next: MindMapFlowNode[],
): MindMapFlowNode[] {
  if (previous.length === 0) return next;
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const old = previousById.get(node.id);
    if (!old) return node; // 新しいノード。採寸は React Flow がこれから行う。
    return { ...old, ...node, measured: old.measured };
  });
}
