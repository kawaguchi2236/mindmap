/**
 * エディタ状態の reducer。純関数（ID と時刻の生成だけ factory 経由で行う）。
 *
 * 状態はノードと「いま選んでいるもの」「いま編集しているもの」だけ。
 * ビューポート（パン・ズーム）は React Flow が持つのでここには入れない。
 * クリップボードも入れない（Undo で巻き戻ってほしくないため clipboard.ts 参照）。
 */
import { createNode } from "@/lib/model/factory";
import type { ID, MindMapNode } from "@/lib/model/types";
import type { ClipboardPayload } from "./clipboard";
import { instantiateClipboard } from "./clipboard";
import {
  estimateNodeHeight,
  findNeighbor,
  H_GAP,
  layoutTree,
  NODE_WIDTH,
  placeNewChild,
  restackAncestors,
  shiftSubtree,
  type NavigateDirection,
} from "./layout";
import {
  getChildren,
  getNode,
  getParent,
  getRoot,
  getVisibleNodes,
  hasChildren,
  isVisible,
  normalizeOrders,
  nextOrder,
  removeSubtree,
  reparent,
  updateNode,
} from "./tree";

export interface EditorState {
  nodes: MindMapNode[];
  selectedId: ID | null;
  editingId: ID | null;
}

export type EditorAction =
  | { type: "select"; id: ID | null }
  | { type: "startEditing"; id?: ID }
  | { type: "stopEditing" }
  | { type: "updateText"; id: ID; text: string }
  | { type: "createChild"; id?: ID }
  | { type: "createSibling"; id?: ID }
  | { type: "outdent"; id?: ID }
  | { type: "deleteNode"; id?: ID }
  | { type: "moveNode"; id: ID; x: number; y: number }
  | { type: "toggleCollapse"; id?: ID }
  | { type: "paste"; clipboard: ClipboardPayload; parentId?: ID }
  | { type: "navigate"; direction: NavigateDirection }
  | { type: "relayout" }
  | { type: "reset"; nodes: MindMapNode[] };

/** ノードを実際に書き換えるアクション（= Undo の対象）。 */
const UNDOABLE_ACTIONS = new Set<EditorAction["type"]>([
  "updateText",
  "createChild",
  "createSibling",
  "outdent",
  "deleteNode",
  "moveNode",
  "toggleCollapse",
  "paste",
  "relayout",
]);

export function isUndoable(action: EditorAction): boolean {
  return UNDOABLE_ACTIONS.has(action.type);
}

export function createInitialState(nodes: MindMapNode[]): EditorState {
  return { nodes, selectedId: getRoot(nodes)?.id ?? null, editingId: null };
}

/** アクションの対象。明示されていなければ選択中ノード、それも無ければルート。 */
function targetOf(state: EditorState, id?: ID): MindMapNode | undefined {
  return getNode(state.nodes, id ?? state.selectedId) ?? getRoot(state.nodes);
}

/** 削除したノードの代わりに選ぶノード: 直前の兄弟 → 無ければ親。 */
function selectionAfterDelete(nodes: MindMapNode[], target: MindMapNode): ID | null {
  const siblings = getChildren(nodes, target.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === target.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  return previous?.id ?? target.parentId;
}

/** 新しいノードを作って挿入し、親の子を order 順に積み直す。 */
function insertNode(
  nodes: MindMapNode[],
  params: { mapId: ID; parentId: ID; order: number },
): { nodes: MindMapNode[]; node: MindMapNode } {
  const { x, y } = placeNewChild(nodes, params.parentId);
  const node = createNode({ ...params, x, y });
  let next = [...nodes, node];
  // 折りたたまれた親の下に作ると新しいノードが見えないので開いておく。
  const parent = getNode(next, params.parentId);
  if (parent?.collapsed) next = updateNode(next, parent.id, { collapsed: false });
  next = normalizeOrders(next, params.parentId);
  next = restackAncestors(next, params.parentId);
  return { nodes: next, node };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "reset":
      return createInitialState(action.nodes);

    case "select": {
      if (action.id === state.selectedId && state.editingId === null) return state;
      return { ...state, selectedId: action.id, editingId: null };
    }

    case "startEditing": {
      const target = targetOf(state, action.id);
      if (!target) return state;
      return { ...state, selectedId: target.id, editingId: target.id };
    }

    case "stopEditing": {
      if (state.editingId === null) return state;
      return { ...state, editingId: null };
    }

    case "updateText": {
      const target = getNode(state.nodes, action.id);
      if (!target || target.text === action.text) return state;
      let nodes = updateNode(state.nodes, action.id, { text: action.text });
      // 入力で行数が増えるとノードが縦に伸びる。高さが変わったときだけ
      // 兄弟を積み直して、下のノードに食い込まないようにする。
      if (estimateNodeHeight(target.text) !== estimateNodeHeight(action.text)) {
        nodes = restackAncestors(nodes, target.parentId);
      }
      return { ...state, nodes };
    }

    case "createChild": {
      const parent = targetOf(state, action.id);
      if (!parent) return state;
      const { nodes, node } = insertNode(state.nodes, {
        mapId: parent.mapId,
        parentId: parent.id,
        order: nextOrder(state.nodes, parent.id),
      });
      return { nodes, selectedId: node.id, editingId: node.id };
    }

    case "createSibling": {
      const target = targetOf(state, action.id);
      if (!target) return state;
      // ルートは1マップに1つなので、ルート上での Enter は子の作成として扱う。
      if (target.parentId === null)
        return editorReducer(state, { type: "createChild", id: target.id });
      const { nodes, node } = insertNode(state.nodes, {
        mapId: target.mapId,
        parentId: target.parentId,
        order: target.order + 0.5,
      });
      return { nodes, selectedId: node.id, editingId: node.id };
    }

    case "outdent": {
      const target = targetOf(state, action.id);
      if (!target) return state;
      const parent = getParent(state.nodes, target.id);
      // ルート自身と、ルート直下の子は上げられない（ルートは1つだけ）。
      if (!parent || parent.parentId === null) return state;
      const grandParent = getNode(state.nodes, parent.parentId);
      if (!grandParent) return state;

      let nodes = reparent(state.nodes, target.id, grandParent.id, parent.order + 0.5);
      if (nodes === state.nodes) return state;
      nodes = shiftSubtree(nodes, target.id, grandParent.x + NODE_WIDTH + H_GAP - target.x, 0);
      nodes = normalizeOrders(nodes, grandParent.id);
      nodes = normalizeOrders(nodes, parent.id);
      // parent → grandParent → … と根まで伝えるので 1 回で足りる。
      nodes = restackAncestors(nodes, parent.id);
      return { ...state, nodes, selectedId: target.id };
    }

    case "deleteNode": {
      const target = targetOf(state, action.id);
      if (!target || target.parentId === null) return state; // ルートは削除しない
      const nextSelected = selectionAfterDelete(state.nodes, target);
      const parentId = target.parentId;
      let nodes = removeSubtree(state.nodes, target.id);
      nodes = normalizeOrders(nodes, parentId);
      nodes = restackAncestors(nodes, parentId);
      return { nodes, selectedId: nextSelected, editingId: null };
    }

    case "moveNode": {
      const target = getNode(state.nodes, action.id);
      if (!target || (target.x === action.x && target.y === action.y)) return state;
      return { ...state, nodes: updateNode(state.nodes, action.id, { x: action.x, y: action.y }) };
    }

    case "toggleCollapse": {
      const target = targetOf(state, action.id);
      if (!target || !hasChildren(state.nodes, target.id)) return state;
      let nodes = updateNode(state.nodes, target.id, { collapsed: !target.collapsed });
      nodes = restackAncestors(nodes, target.parentId);
      // 折りたたんだ内側に選択・編集が残らないようにする。
      const selectedId =
        state.selectedId && isVisible(nodes, state.selectedId) ? state.selectedId : target.id;
      const editingId =
        state.editingId && isVisible(nodes, state.editingId) ? state.editingId : null;
      return { nodes, selectedId, editingId };
    }

    case "paste": {
      const parent = targetOf(state, action.parentId);
      if (!parent) return state;
      const clones = instantiateClipboard(action.clipboard, {
        parentId: parent.id,
        mapId: parent.mapId,
        order: nextOrder(state.nodes, parent.id),
      });
      if (clones.length === 0) return state;
      const { x, y } = placeNewChild(state.nodes, parent.id);
      const cloneRoot = clones[0];
      const dx = x - cloneRoot.x;
      const dy = y - cloneRoot.y;
      let nodes = [...state.nodes, ...clones.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }))];
      if (parent.collapsed) nodes = updateNode(nodes, parent.id, { collapsed: false });
      nodes = normalizeOrders(nodes, parent.id);
      nodes = restackAncestors(nodes, parent.id);
      return { nodes, selectedId: cloneRoot.id, editingId: null };
    }

    case "navigate": {
      const visible = getVisibleNodes(state.nodes);
      if (visible.length === 0) return state;
      const from = getNode(visible, state.selectedId);
      if (!from) return { ...state, selectedId: visible[0].id, editingId: null };
      const nextId = findNeighbor(visible, from.id, action.direction);
      if (nextId === null || nextId === state.selectedId) return state;
      return { ...state, selectedId: nextId, editingId: null };
    }

    case "relayout": {
      const nodes = layoutTree(state.nodes);
      if (nodes === state.nodes) return state;
      return { ...state, nodes };
    }

    default:
      return state;
  }
}
