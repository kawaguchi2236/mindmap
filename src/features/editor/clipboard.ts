/**
 * ノード部分木のコピー&ペースト。
 *
 * クリップボードはエディタ状態（Undo のスナップショット対象）に入れない。
 * 入れてしまうと Undo でクリップボードの中身まで巻き戻ってしまうため。
 */
import type { ID, MindMapNode } from "@/lib/model/types";
import { cloneSubtree, getNode, getSubtreeIds } from "./tree";

export interface ClipboardPayload {
  /** コピー時点の部分木のスナップショット（行きがけ順、先頭が部分木のルート）。 */
  nodes: MindMapNode[];
  /** スナップショット内での部分木ルートの ID。 */
  rootId: ID;
}

/** 選択ノードの部分木をクリップボードへ取り込む。ノードが無ければ null。 */
export function copySubtree(nodes: MindMapNode[], id: ID | null): ClipboardPayload | null {
  if (id == null || !getNode(nodes, id)) return null;
  const ids = new Set(getSubtreeIds(nodes, id));
  const snapshot = nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node }));
  return { nodes: snapshot, rootId: id };
}

/**
 * クリップボードの部分木を parentId の子として複製する。ID はすべて振り直す。
 * 返り値の先頭が貼り付けられた部分木のルート。
 */
export function instantiateClipboard(
  payload: ClipboardPayload,
  options: { parentId: ID; mapId: ID; order: number },
): MindMapNode[] {
  return cloneSubtree(payload.nodes, payload.rootId, options);
}
