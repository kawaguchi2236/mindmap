/**
 * MindMapNode[] に対する木操作。すべて純関数で DOM に依存しない。
 *
 * 設計方針（CLAUDE.md §7）: 親子関係は Node.parentId から導出する。
 * 別途 Edge を持たない。並び順は同じ親を持つ兄弟のなかの `order` 昇順。
 */
import { newId, now } from "@/lib/model/factory";
import type { ID, MindMapNode } from "@/lib/model/types";

/** 兄弟の並び順。order が同値なら createdAt → id で決定的に並べる。 */
export function compareSiblings(a: MindMapNode, b: MindMapNode): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 親 ID をキーに、order 昇順に並べた子ノードの索引を作る。走査を繰り返すときに使う。 */
export function buildChildIndex(nodes: MindMapNode[]): Map<ID | null, MindMapNode[]> {
  const index = new Map<ID | null, MindMapNode[]>();
  for (const node of nodes) {
    const bucket = index.get(node.parentId);
    if (bucket) bucket.push(node);
    else index.set(node.parentId, [node]);
  }
  for (const bucket of index.values()) bucket.sort(compareSiblings);
  return index;
}

export function getRoot(nodes: MindMapNode[]): MindMapNode | undefined {
  return nodes.find((node) => node.parentId === null);
}

export function getNode(nodes: MindMapNode[], id: ID | null | undefined): MindMapNode | undefined {
  if (id == null) return undefined;
  return nodes.find((node) => node.id === id);
}

export function getParent(
  nodes: MindMapNode[],
  id: ID | null | undefined,
): MindMapNode | undefined {
  const node = getNode(nodes, id);
  return node ? getNode(nodes, node.parentId) : undefined;
}

/** 指定した親の子を order 昇順で返す。parentId が null ならルート。 */
export function getChildren(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  return nodes.filter((node) => node.parentId === parentId).sort(compareSiblings);
}

/** 自分を含む兄弟を order 昇順で返す。 */
export function getSiblings(nodes: MindMapNode[], id: ID): MindMapNode[] {
  const node = getNode(nodes, id);
  if (!node) return [];
  return getChildren(nodes, node.parentId);
}

export function hasChildren(nodes: MindMapNode[], id: ID): boolean {
  return nodes.some((node) => node.parentId === id);
}

/** 自分を含む部分木の ID を行きがけ順で返す。 */
export function getSubtreeIds(nodes: MindMapNode[], id: ID): ID[] {
  const index = buildChildIndex(nodes);
  const result: ID[] = [];
  const walk = (currentId: ID): void => {
    result.push(currentId);
    for (const child of index.get(currentId) ?? []) walk(child.id);
  };
  if (!nodes.some((node) => node.id === id)) return result;
  walk(id);
  return result;
}

/** 自分を除く子孫の ID。 */
export function getDescendantIds(nodes: MindMapNode[], id: ID): ID[] {
  return getSubtreeIds(nodes, id).slice(1);
}

export function isDescendantOf(nodes: MindMapNode[], id: ID, ancestorId: ID): boolean {
  let current = getNode(nodes, id);
  while (current?.parentId != null) {
    if (current.parentId === ancestorId) return true;
    current = getNode(nodes, current.parentId);
  }
  return false;
}

/** ルートを 0 とした深さ。見つからなければ 0。 */
export function getDepth(nodes: MindMapNode[], id: ID): number {
  let depth = 0;
  let current = getNode(nodes, id);
  while (current?.parentId != null) {
    depth += 1;
    current = getNode(nodes, current.parentId);
  }
  return depth;
}

/**
 * 画面に描画すべきノードを行きがけ順で返す。
 * collapsed なノード自身は含めるが、その子孫は含めない。
 */
export function getVisibleNodes(nodes: MindMapNode[]): MindMapNode[] {
  const index = buildChildIndex(nodes);
  const result: MindMapNode[] = [];
  const walk = (node: MindMapNode): void => {
    result.push(node);
    if (node.collapsed) return;
    for (const child of index.get(node.id) ?? []) walk(child);
  };
  for (const root of index.get(null) ?? []) walk(root);
  return result;
}

export function isVisible(nodes: MindMapNode[], id: ID): boolean {
  let current = getNode(nodes, id);
  while (current?.parentId != null) {
    const parent = getNode(nodes, current.parentId);
    if (!parent) return false;
    if (parent.collapsed) return false;
    current = parent;
  }
  return current != null;
}

/** その親の末尾に追加するための order。 */
export function nextOrder(nodes: MindMapNode[], parentId: ID | null): number {
  const children = getChildren(nodes, parentId);
  if (children.length === 0) return 0;
  return children[children.length - 1].order + 1;
}

export function updateNode(
  nodes: MindMapNode[],
  id: ID,
  patch: Partial<Omit<MindMapNode, "id" | "mapId">>,
): MindMapNode[] {
  const timestamp = now();
  return nodes.map((node) => (node.id === id ? { ...node, ...patch, updatedAt: timestamp } : node));
}

/** 複数ノードをまとめて更新する（更新の走査を1回で済ませる）。 */
export function patchNodes(
  nodes: MindMapNode[],
  patches: Map<ID, Partial<Omit<MindMapNode, "id" | "mapId">>>,
): MindMapNode[] {
  if (patches.size === 0) return nodes;
  const timestamp = now();
  return nodes.map((node) => {
    const patch = patches.get(node.id);
    return patch ? { ...node, ...patch, updatedAt: timestamp } : node;
  });
}

/** 部分木ごと削除する。ルートは削除しない。 */
export function removeSubtree(nodes: MindMapNode[], id: ID): MindMapNode[] {
  const target = getNode(nodes, id);
  if (!target || target.parentId === null) return nodes;
  const removed = new Set(getSubtreeIds(nodes, id));
  return nodes.filter((node) => !removed.has(node.id));
}

/**
 * 親を付け替える。循環（自分の子孫を新しい親にする）は拒否する。
 * 位置の再計算は行わない（layout.ts の責務）。
 */
export function reparent(
  nodes: MindMapNode[],
  id: ID,
  newParentId: ID,
  order: number,
): MindMapNode[] {
  const target = getNode(nodes, id);
  if (!target || target.parentId === null) return nodes;
  if (id === newParentId) return nodes;
  if (!getNode(nodes, newParentId)) return nodes;
  if (isDescendantOf(nodes, newParentId, id)) return nodes;
  return updateNode(nodes, id, { parentId: newParentId, order });
}

/** 同じ親を持つ兄弟の order を 0,1,2,... に振り直す。小数 order の累積を避ける。 */
export function normalizeOrders(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  const children = getChildren(nodes, parentId);
  const orders = new Map<ID, number>();
  children.forEach((child, i) => {
    if (child.order !== i) orders.set(child.id, i);
  });
  if (orders.size === 0) return nodes;
  return nodes.map((node) => {
    const order = orders.get(node.id);
    return order === undefined ? node : { ...node, order };
  });
}

/**
 * 部分木を複製する。ID はすべて振り直す（コピー&ペースト・テンプレート用）。
 * 返り値の先頭が複製された部分木のルート。元の配列は変更しない。
 */
export function cloneSubtree(
  source: MindMapNode[],
  rootId: ID,
  options: { parentId: ID | null; mapId: ID; order?: number },
): MindMapNode[] {
  const ids = getSubtreeIds(source, rootId);
  if (ids.length === 0) return [];
  const idMap = new Map<ID, ID>();
  for (const id of ids) idMap.set(id, newId());
  const timestamp = now();
  const byId = new Map(source.map((node) => [node.id, node]));
  return ids.map((id, i) => {
    const original = byId.get(id) as MindMapNode;
    const isCloneRoot = i === 0;
    return {
      ...original,
      id: idMap.get(id) as ID,
      mapId: options.mapId,
      parentId: isCloneRoot
        ? options.parentId
        : ((idMap.get(original.parentId as ID) ?? options.parentId) as ID | null),
      order: isCloneRoot ? (options.order ?? original.order) : original.order,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  });
}
