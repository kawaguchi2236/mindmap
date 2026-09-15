import { createNode } from "@/lib/model/factory";
import type { ID, MindMapNode } from "@/lib/model/types";
import { buildDepthIndex, getChildren, getRoot } from "@/features/editor/tree";
import { nodeBox, type NodeBox } from "@/features/editor/layout";

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

/**
 * ノードの占める矩形。大きさは階層ごとの文字組みで決まるので、
 * テスト側でも深さを見て求める（src/features/editor/layout.ts と同じ関数を使う）。
 */
export function boxOf(nodes: MindMapNode[], node: MindMapNode): NodeBox {
  return nodeBox(node.text, buildDepthIndex(nodes).get(node.id) ?? 0);
}

/** boxOf().height の短縮。積み上がりの検証で多用する。 */
export function heightOf(nodes: MindMapNode[], node: MindMapNode): number {
  return boxOf(nodes, node).height;
}
