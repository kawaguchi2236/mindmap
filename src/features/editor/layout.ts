/**
 * 横型マインドマップのレイアウト。親から右方向へ子が伸びる。
 * すべて純関数で、x/y（ノードの左上座標）を計算して返す。
 *
 * 方針（CLAUDE.md §37）: dagre 等のレイアウトライブラリは入れない。
 * 子の部分木の高さを積み上げて縦位置を決める素直な実装で足りる。
 *
 * 自動整列は「新規ノードの配置」と「明示的な一括整列」のときだけ走らせる。
 * ユーザーがドラッグで動かした位置は構造変更で勝手に戻さない。
 */
import type { ID, MindMapNode } from "@/lib/model/types";
import { buildChildIndex, getNode, getSubtreeIds, patchNodes } from "./tree";

/** レイアウト計算で仮定するノードの大きさ。実 DOM は多少伸縮する。 */
export const NODE_WIDTH = 180;
/** 1行のノードの高さ。estimateNodeHeight の下限でもある。 */
export const NODE_HEIGHT = 44;
/** 折り返し1行あたりの高さ（font-size 14px × line-height 1.4）。 */
export const NODE_LINE_HEIGHT = 20;
/** 上下 padding と枠線のぶん。1行のとき 20 + 24 = 44 になるよう選んである。 */
export const NODE_VERTICAL_PADDING = 24;
/** テキストを折り返す内容幅。NODE_WIDTH から左右の padding を引いた値。 */
const NODE_CONTENT_WIDTH = 140;
const FONT_SIZE = 14;
/** 見積もりは必ず安全側（多め）に倒す。少なく見積もるとノードが重なる。 */
const SAFETY_MARGIN = 1.05;
/** 親子の水平間隔。 */
export const H_GAP = 64;
/** 兄弟（の部分木）の垂直間隔。 */
export const V_GAP = 16;

export type NavigateDirection = "up" | "down" | "left" | "right";

/** 深さ d のノードの x 座標。 */
export function depthToX(depth: number): number {
  return depth * (NODE_WIDTH + H_GAP);
}

/**
 * 1文字の幅を em 単位で見積もる。全角（CJK・かな・全角記号）は 1.0em、
 * それ以外は 0.55em として扱う。
 */
function charWidthEm(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  const isWide =
    (code >= 0x1100 && code <= 0x115f) || // ハングル字母
    (code >= 0x2e80 && code <= 0x303e) || // CJK 部首・記号
    (code >= 0x3041 && code <= 0x33ff) || // かな・互換
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) || // CJK 統合漢字
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) || // ハングル音節
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) || // 全角英数・記号
    (code >= 0xffe0 && code <= 0xffe6);
  return isWide ? 1 : 0.55;
}

/**
 * 折り返し後の行数を見積もる。明示的な改行も数える。
 * 実測（ResizeObserver）には頼らない：固定寸法を渡す構成では measured が
 * 入らないため、レイアウトと描画の両方がこの同じ関数を使う。
 */
export function estimateLineCount(text: string): number {
  if (text.length === 0) return 1;
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0;
    let linesInParagraph = 1;
    for (const char of paragraph) {
      const width = charWidthEm(char) * FONT_SIZE * SAFETY_MARGIN;
      if (used + width > NODE_CONTENT_WIDTH) {
        linesInParagraph += 1;
        used = width;
      } else {
        used += width;
      }
    }
    lines += linesInParagraph;
  }
  return lines;
}

/**
 * ノードの高さを、採寸に頼らずテキストから決める。
 * レイアウト（兄弟の積み上げ）とノード描画の両方がこれを使うことで、
 * 折り返したノードの下に兄弟が食い込む問題を防ぐ。
 */
export function estimateNodeHeight(text: string): number {
  return Math.max(NODE_HEIGHT, estimateLineCount(text) * NODE_LINE_HEIGHT + NODE_VERTICAL_PADDING);
}

/** レイアウト計算で使うノードの高さ。 */
function heightOf(node: MindMapNode): number {
  return estimateNodeHeight(node.text);
}

/**
 * 木全体を整列する。collapsed なノードは葉として扱い、その子孫の座標は動かさない。
 */
export function layoutTree(nodes: MindMapNode[]): MindMapNode[] {
  const index = buildChildIndex(nodes);
  const heights = new Map<ID, number>();

  const measure = (node: MindMapNode): number => {
    const own = heightOf(node);
    const children = node.collapsed ? [] : (index.get(node.id) ?? []);
    if (children.length === 0) {
      heights.set(node.id, own);
      return own;
    }
    let total = 0;
    for (const child of children) total += measure(child);
    total += V_GAP * (children.length - 1);
    const height = Math.max(own, total);
    heights.set(node.id, height);
    return height;
  };

  const patches = new Map<ID, Partial<MindMapNode>>();
  const place = (node: MindMapNode, depth: number, top: number): void => {
    const height = heights.get(node.id) ?? heightOf(node);
    const x = depthToX(depth);
    const y = top + (height - heightOf(node)) / 2;
    if (node.x !== x || node.y !== y) patches.set(node.id, { x, y });
    if (node.collapsed) return;
    let cursor = top;
    for (const child of index.get(node.id) ?? []) {
      place(child, depth + 1, cursor);
      cursor += (heights.get(child.id) ?? heightOf(child)) + V_GAP;
    }
  };

  let rootTop = 0;
  for (const root of index.get(null) ?? []) {
    measure(root);
    place(root, 0, rootTop);
    rootTop += (heights.get(root.id) ?? heightOf(root)) + V_GAP;
  }
  return patchNodes(nodes, patches);
}

/** 表示されている部分木が占める縦方向の範囲。collapsed の先は数えない。 */
export function subtreeBounds(nodes: MindMapNode[], id: ID): { top: number; bottom: number } {
  const index = buildChildIndex(nodes);
  const start = getNode(nodes, id);
  if (!start) return { top: 0, bottom: 0 };
  let top = start.y;
  let bottom = start.y + heightOf(start);
  const walk = (node: MindMapNode): void => {
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + heightOf(node));
    if (node.collapsed) return;
    for (const child of index.get(node.id) ?? []) walk(child);
  };
  walk(start);
  return { top, bottom };
}

/** 部分木ごと平行移動する。 */
export function shiftSubtree(nodes: MindMapNode[], id: ID, dx: number, dy: number): MindMapNode[] {
  if (dx === 0 && dy === 0) return nodes;
  const ids = new Set(getSubtreeIds(nodes, id));
  if (ids.size === 0) return nodes;
  const patches = new Map<ID, Partial<MindMapNode>>();
  for (const node of nodes) {
    if (ids.has(node.id)) patches.set(node.id, { x: node.x + dx, y: node.y + dy });
  }
  return patchNodes(nodes, patches);
}

/**
 * ある親の子たちを order 順に縦へ積み直す。
 * 各子は部分木ごと剛体移動するので、子孫内で手動調整した相対位置は保たれる。
 * ノードを増やしたときに「場所を空ける」ための処理。
 */
export function restackSiblings(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  const index = buildChildIndex(nodes);
  const children = index.get(parentId) ?? [];
  if (children.length === 0) return nodes;

  const bounds = children.map((child) => subtreeBounds(nodes, child.id));
  let cursor = Math.min(...bounds.map((b) => b.top));
  let result = nodes;
  children.forEach((child, i) => {
    const delta = cursor - bounds[i].top;
    if (delta !== 0) result = shiftSubtree(result, child.id, 0, delta);
    cursor += bounds[i].bottom - bounds[i].top + V_GAP;
  });
  return result;
}

/**
 * parentId の階層から根まで、順に積み直す。
 *
 * restackSiblings は 1 階層しか直さない。ノードを増やしたり文字を打って
 * 行数が増えたりすると、その部分木の高さが変わる。1 階層で止めると
 * 「親の兄弟」が元の位置に残り、伸びた部分木に食い込む。
 * 下から上へ順に積み直して、変化を根まで伝える。
 */
export function restackAncestors(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  let result = nodes;
  let current: ID | null = parentId;
  // 親子関係が壊れていても無限ループにしない。
  const seen = new Set<ID>();
  for (;;) {
    result = restackSiblings(result, current);
    if (current === null) return result;
    if (seen.has(current)) return result;
    seen.add(current);
    current = getNode(result, current)?.parentId ?? null;
  }
}

/**
 * 見えているノードが1組も重ならないところまで、下へずらして解消する。
 *
 * 積み直し（restackAncestors）だけでは、ドラッグで動かした位置や、
 * 修正前に保存された座標が残っているマップで重なりが残る。ユーザーから見ると
 * 「Enter を押したのに被ったまま」になり、自動整列を押すまで直らない。
 * それでは考えながら書けないので、構造が変わるたびにここで必ず解消する。
 *
 * 方針:
 * - 木の順（親 → 子、兄弟は order 順）に確定していき、**先に置いたものは動かさない**。
 *   後から来たものだけを下げるので、既存の配置が大きく動かない。
 * - 下げるときは部分木ごと動かす。子孫だけ取り残されない。
 * - 横に重なっていない（別の列にいる）ものは触らない。
 */
export function resolveOverlaps(nodes: MindMapNode[]): MindMapNode[] {
  const index = buildChildIndex(nodes);
  const pos = new Map<ID, { x: number; y: number }>();
  const height = new Map<ID, number>();
  for (const node of nodes) {
    pos.set(node.id, { x: node.x, y: node.y });
    height.set(node.id, heightOf(node));
  }

  type Rect = { left: number; right: number; top: number; bottom: number };
  const placed: Rect[] = [];

  const rectOf = (id: ID): Rect => {
    const p = pos.get(id) ?? { x: 0, y: 0 };
    return {
      left: p.x,
      right: p.x + NODE_WIDTH,
      top: p.y,
      bottom: p.y + (height.get(id) ?? NODE_HEIGHT),
    };
  };

  /** 部分木ごと下へずらす。折りたたまれた子孫も一緒に動かす。 */
  const shiftDown = (id: ID, dy: number): void => {
    const stack: ID[] = [id];
    while (stack.length > 0) {
      const current = stack.pop() as ID;
      const p = pos.get(current);
      if (p) pos.set(current, { x: p.x, y: p.y + dy });
      for (const child of index.get(current) ?? []) stack.push(child.id);
    }
  };

  const overlapBottom = (rect: Rect): number | null => {
    let bottom: number | null = null;
    for (const other of placed) {
      const hit =
        rect.left < other.right &&
        other.left < rect.right &&
        rect.top < other.bottom &&
        other.top < rect.bottom;
      if (hit) bottom = bottom === null ? other.bottom : Math.max(bottom, other.bottom);
    }
    return bottom;
  };

  const place = (node: MindMapNode): void => {
    let rect = rectOf(node.id);
    // ずらすと別のものに当たることがあるので、当たらなくなるまで繰り返す。
    // 下方向にしか動かさないので、確定済みの個数で必ず止まる。
    for (let guard = 0; guard <= placed.length; guard += 1) {
      const bottom = overlapBottom(rect);
      if (bottom === null) break;
      shiftDown(node.id, bottom + V_GAP - rect.top);
      rect = rectOf(node.id);
    }
    placed.push(rect);
    if (node.collapsed) return;
    for (const child of index.get(node.id) ?? []) place(child);
  };

  for (const root of index.get(null) ?? []) place(root);

  const patches = new Map<ID, Partial<MindMapNode>>();
  for (const node of nodes) {
    const p = pos.get(node.id);
    if (p && (p.x !== node.x || p.y !== node.y)) patches.set(node.id, { x: p.x, y: p.y });
  }
  return patchNodes(nodes, patches);
}

/**
 * 構造が変わったあとの再配置。積み直して、それでも残る重なりを解消する。
 * ノードを増やす・消す・文字を変える・階層を動かす、のすべてがこれを通る。
 */
export function reflow(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  return resolveOverlaps(restackAncestors(nodes, parentId));
}

/**
 * これから parentId の子として作るノードの初期座標。
 * 直後に restackSiblings が order どおりに縦位置を直すので、ここでは
 * 「既存の兄弟の下」に置いておけばよい。
 */
export function placeNewChild(nodes: MindMapNode[], parentId: ID | null): { x: number; y: number } {
  const parent = getNode(nodes, parentId);
  if (!parent) return { x: 0, y: 0 };
  const index = buildChildIndex(nodes);
  const siblings = index.get(parent.id) ?? [];
  const x = parent.x + NODE_WIDTH + H_GAP;
  if (siblings.length === 0) return { x, y: parent.y };
  const bottom = Math.max(...siblings.map((sibling) => subtreeBounds(nodes, sibling.id).bottom));
  return { x, y: bottom + V_GAP };
}

/**
 * 矢印キーの移動先。表示中のノードのうち、指定方向にあるもっとも近いノードを返す。
 * 主軸の距離に、軸ずれのペナルティ（2倍）を足した値で評価する。
 */
export function findNeighbor(
  visibleNodes: MindMapNode[],
  fromId: ID,
  direction: NavigateDirection,
): ID | null {
  const from = visibleNodes.find((node) => node.id === fromId);
  if (!from) return null;
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const center = (node: MindMapNode): { cx: number; cy: number } => ({
    cx: node.x + NODE_WIDTH / 2,
    cy: node.y + heightOf(node) / 2,
  });
  const origin = center(from);

  let bestId: ID | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of visibleNodes) {
    if (node.id === fromId) continue;
    const c = center(node);
    const primary = sign * (horizontal ? c.cx - origin.cx : c.cy - origin.cy);
    if (primary <= 1) continue;
    const cross = Math.abs(horizontal ? c.cy - origin.cy : c.cx - origin.cx);
    const score = primary + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      bestId = node.id;
    }
  }
  return bestId;
}
