import { createNode } from "@/lib/model/factory";
import type { ID, MindMapNode } from "@/lib/model/types";
import { getChildren, getRoot } from "@/features/editor/tree";

export const MAP_ID = "map-1";

/**
 * テキストの配列からテスト用の木を作る。
 * ネストは「タイトル」ではなく配列の入れ子で表す。
 */
export interface TreeSpec {
  text: string;
  collapsed?: boolean;
  children?: TreeSpec[];
}

export function buildTree(spec: TreeSpec): MindMapNode[] {
  const nodes: MindMapNode[] = [];
  const walk = (current: TreeSpec, parentId: ID | null, order: number): void => {
    const node = createNode({
      mapId: MAP_ID,
      parentId,
      text: current.text,
      order,
      collapsed: current.collapsed ?? false,
    });
    nodes.push(node);
    (current.children ?? []).forEach((child, i) => walk(child, node.id, i));
  };
  walk(spec, null, 0);
  return nodes;
}

export function findByText(nodes: MindMapNode[], text: string): MindMapNode {
  const found = nodes.find((node) => node.text === text);
  if (!found) throw new Error(`ノードが見つかりません: ${text}`);
  return found;
}

export function rootId(nodes: MindMapNode[]): ID {
  const root = getRoot(nodes);
  if (!root) throw new Error("ルートがありません");
  return root.id;
}

/** 親の子を order 順にテキストで並べた配列。並び順の検証に使う。 */
export function childTexts(nodes: MindMapNode[], parentId: ID | null): string[] {
  return getChildren(nodes, parentId).map((node) => node.text);
}

/** 木構造を "親>子" の集合として文字列化する。構造比較に使う。 */
export function outline(nodes: MindMapNode[]): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const lines: string[] = [];
  const walk = (id: ID, depth: number): void => {
    const node = byId.get(id);
    if (!node) return;
    lines.push(`${"  ".repeat(depth)}${node.text}`);
    for (const child of getChildren(nodes, id)) walk(child.id, depth + 1);
  };
  const root = getRoot(nodes);
  if (root) walk(root.id, 0);
  return lines;
}
