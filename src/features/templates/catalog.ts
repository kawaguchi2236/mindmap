/**
 * テンプレートの一覧（docs/要件定義.md SCR-005 / design/ハンドオフ.md `#3c`）。
 *
 * 要件は「Phase 1 では画面だけ先行してもよい」としているが、選んでも何も
 * 起きない画面を置くほうが不誠実なので、木の中身まで持たせて実際にマップを
 * 作れるようにする。とはいえ中身は**ただのテキストの入れ子**で、専用の
 * データ構造は作らない（CLAUDE.md §37）。
 *
 * ここは純粋なデータと純関数だけ。IndexedDB には触らない。
 */
import { createNode } from "@/lib/model/factory";
import type { ID, MindMapNode } from "@/lib/model/types";
import { layoutTree } from "@/features/editor";

/** テンプレートの分類。ハンドオフ `#3c` のタブと同じ並び。 */
export const TEMPLATE_CATEGORIES = ["ビジネス", "学習", "ブレスト", "キャリア", "読書"] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** テンプレートの木。テキストの入れ子だけで表す。 */
export interface TemplateNode {
  text: string;
  children?: TemplateNode[];
}

/** プレビューの線画の種類。実際の SVG は TemplatePreview.tsx が持つ。 */
export type TemplatePreviewKind =
  | "quadrants"
  | "timeline"
  | "breakdown"
  | "stack"
  | "radial"
  | "columns"
  | "cards"
  | "ladder"
  | "blank";

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  preview: TemplatePreviewKind;
  /** マップの初期タイトル。既定はテンプレート名。 */
  title?: string;
  /** null は「空のマップ」。ルート1つだけの新規マップになる。 */
  tree: TemplateNode | null;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: "swot",
    name: "SWOT 分析",
    category: "ビジネス",
    preview: "quadrants",
    tree: {
      text: "SWOT 分析",
      children: [{ text: "強み" }, { text: "弱み" }, { text: "機会" }, { text: "脅威" }],
    },
  },
  {
    id: "roadmap",
    name: "ロードマップ",
    category: "ビジネス",
    preview: "timeline",
    tree: {
      text: "ロードマップ",
      children: [
        { text: "いま", children: [{ text: "ゴール" }, { text: "やること" }] },
        { text: "次の四半期", children: [{ text: "ゴール" }, { text: "やること" }] },
        { text: "半年後", children: [{ text: "ゴール" }, { text: "やること" }] },
        { text: "一年後", children: [{ text: "ゴール" }, { text: "やること" }] },
      ],
    },
  },
  {
    id: "wbs",
    name: "WBS 分解",
    category: "ビジネス",
    preview: "breakdown",
    tree: {
      text: "WBS 分解",
      children: [
        { text: "要件" },
        { text: "設計" },
        { text: "実装", children: [{ text: "画面" }, { text: "データ" }] },
        { text: "検証" },
      ],
    },
  },
  {
    id: "okr",
    name: "OKR 設計",
    category: "ビジネス",
    preview: "stack",
    tree: {
      text: "OKR 設計",
      children: [
        { text: "Objective" },
        { text: "Key Results", children: [{ text: "KR1" }, { text: "KR2" }, { text: "KR3" }] },
        { text: "期間" },
      ],
    },
  },
  {
    id: "ideas",
    name: "アイデア整理",
    category: "ブレスト",
    preview: "radial",
    tree: {
      text: "アイデア",
      children: [
        { text: "思いついたこと" },
        { text: "気になること" },
        { text: "試すこと" },
        { text: "やめること" },
      ],
    },
  },
  {
    id: "reading",
    name: "読書メモ",
    category: "読書",
    preview: "columns",
    title: "読書メモ",
    tree: {
      text: "本のタイトル",
      children: [
        { text: "著者" },
        { text: "要点" },
        { text: "引用" },
        { text: "感想" },
        { text: "次に読む" },
      ],
    },
  },
  {
    id: "study",
    name: "学習ノート",
    category: "学習",
    preview: "cards",
    title: "学習ノート",
    tree: {
      text: "学習テーマ",
      children: [
        { text: "目的" },
        { text: "わかったこと" },
        { text: "わからないこと", children: [{ text: "調べる" }, { text: "人に聞く" }] },
        { text: "用語" },
        { text: "次にやること" },
      ],
    },
  },
  {
    id: "career",
    name: "キャリア棚卸し",
    category: "キャリア",
    preview: "ladder",
    tree: {
      text: "キャリア棚卸し",
      children: [
        { text: "できること" },
        { text: "やりたいこと" },
        { text: "大事にしたいこと" },
        { text: "次の一歩" },
      ],
    },
  },
];

/** 「空のマップ」。テンプレート一覧の最後に置く枠（ハンドオフ `#3c`）。 */
export const BLANK_TEMPLATE: Template = {
  id: "blank",
  name: "空のマップ",
  category: "ビジネス",
  preview: "blank",
  tree: null,
};

/** 木に含まれるノードの総数（ルートを含む）。 */
export function countNodes(tree: TemplateNode | null): number {
  if (tree === null) return 1;
  return 1 + (tree.children ?? []).reduce((total, child) => total + countNodes(child), 0);
}

/** 一覧の項目に添えるメタ表記。ハンドオフは mono・全大文字。 */
export function describeTemplate(template: Template): string {
  if (template.tree === null) return "START BLANK";
  return `${countNodes(template.tree)} NODES · ${template.category}`;
}

/**
 * テンプレートの木を、そのマップのノード配列にする。
 * 座標はエディタと同じ自動レイアウトで決める（手置きの値は持たない）。
 */
export function buildTemplateNodes(mapId: ID, tree: TemplateNode): MindMapNode[] {
  const nodes: MindMapNode[] = [];
  const walk = (current: TemplateNode, parentId: ID | null, order: number): void => {
    const node = createNode({ mapId, parentId, text: current.text, order });
    nodes.push(node);
    (current.children ?? []).forEach((child, index) => walk(child, node.id, index));
  };
  walk(tree, null, 0);
  return layoutTree(nodes);
}
