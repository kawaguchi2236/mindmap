/**
 * 横型マインドマップのレイアウト。親から右方向へ子が伸びる。
 * すべて純関数で、x/y（ノードの左上座標）を計算して返す。
 *
 * 方針（CLAUDE.md §37）: dagre 等のレイアウトライブラリは入れない。
 * 子の部分木の高さを積み上げて縦位置を決める素直な実装で足りる。
 *
 * 自動整列は「新規ノードの配置」と「明示的な一括整列」のときだけ走らせる。
 * ユーザーがドラッグで動かした位置は構造変更で勝手に戻さない。
 *
 * ノードの大きさは**階層ごとに違う**（design/ハンドオフ.md `#2b`）。枠を持たない
 * 文字だけのノードで、ルート 34px・第2階層 22px・第3階層以下 17px の
 * セリフ体で組む。大きさが階層に依存するため、この中の計算はほぼすべて
 * 「ノード＋深さ」の組で行う。深さは buildDepthIndex で一度だけ配る。
 */
import type { ID, MindMapNode } from "@/lib/model/types";
import {
  buildChildIndex,
  buildDepthIndex,
  getNode,
  getSubtreeIds,
  isVisible,
  patchNodes,
} from "./tree";

/** 階層ごとの文字組み。値は design/ハンドオフ.md `#2b` の実測値。 */
export interface NodeTier {
  /** 文字サイズ（px）。 */
  fontSize: number;
  /** 1行の高さ（px）。ノードの高さは行数 × これ。 */
  lineHeight: number;
  /** テキストを折り返す上限幅（px）。これ以上は横に伸ばさず折り返す。 */
  maxWidth: number;
}

export const NODE_TIERS: readonly NodeTier[] = [
  { fontSize: 34, lineHeight: 42, maxWidth: 260 }, // ルート
  { fontSize: 22, lineHeight: 30, maxWidth: 240 }, // 第2階層
  { fontSize: 17, lineHeight: 26, maxWidth: 220 }, // 第3階層以下
];

/** 深さに対応する文字組み。最下段のティアより深いところは同じ組みを使い回す。 */
export function tierOf(depth: number): NodeTier {
  const index = Math.min(Math.max(depth, 0), NODE_TIERS.length - 1);
  return NODE_TIERS[index];
}

/**
 * ルート直下に出す `ROOT · N NODES` ラベルの占める高さ（px）。
 *
 * これはレイアウトの高さには**数えない**。ラベルはノードの下に絶対配置で
 * 重ねるだけで、兄弟ノードとの間隔（V_GAP）に収まるため。
 */
export const ROOT_META_HEIGHT = 18;

/** 親子の列の間隔。ルート→第2階層だけ広い（ハンドオフの実測 320 / 300）。 */
const COLUMN_STEP_FROM_ROOT = 320;
const COLUMN_STEP = 300;

/** 深さ d の親から見た、子の列までの水平距離。 */
export function columnStep(parentDepth: number): number {
  return parentDepth === 0 ? COLUMN_STEP_FROM_ROOT : COLUMN_STEP;
}

/** 深さ d のノードの x 座標（整列したときの既定位置）。 */
export function depthToX(depth: number): number {
  if (depth <= 0) return 0;
  return COLUMN_STEP_FROM_ROOT + (depth - 1) * COLUMN_STEP;
}

/** 兄弟（の部分木）の垂直間隔。文字だけのノードなので行間として効く。 */
export const V_GAP = 34;

export type NavigateDirection = "up" | "down" | "left" | "right";

/**
 * 1文字の幅を em 単位で見積もる。全角（CJK・かな・全角記号）は 1.0em。
 * 欧文は字送りの差が大きいので、細い字だけ分けて平均に寄せる。
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
  if (isWide) return 1;
  if (NARROW_LATIN.has(char)) return 0.32;
  return 0.54;
}

/** セリフ体で明らかに細い字。ここを平均で見積もると幅が余りすぎる。 */
const NARROW_LATIN = new Set("ijlt.,;:'\"!|()[]{}/\\`-· ".split(""));

/**
 * 見積もりは安全側（多め）に倒す。少なく見積もると、想定より早く折り返して
 * 行数の見積もりと実際の描画がずれ、ノードが重なる。
 */
const SAFETY_MARGIN = 1.06;

/** テキスト1行ぶんの幅（px）。 */
function lineWidth(line: string, fontSize: number): number {
  let em = 0;
  for (const char of line) em += charWidthEm(char);
  return em * fontSize * SAFETY_MARGIN;
}

/**
 * 折り返さずに置いたときの幅（px）。改行を含む場合は最も長い行の幅。
 * 空文字でも 0 にはしない（プレースホルダの「（無題）」が入るため）。
 */
function naturalWidth(text: string, fontSize: number): number {
  if (text.length === 0) return lineWidth("（無題）", fontSize);
  let widest = 0;
  for (const line of text.split("\n")) widest = Math.max(widest, lineWidth(line, fontSize));
  return widest;
}

/**
 * ノードの幅。テキストに合わせて縮み、ティアの上限で止まる。
 *
 * 枠を持たないので、この幅が**そのまま接続線の始点**になる（ハンドルを
 * 右端に置く）。固定幅にすると、短いノードからテキストの遥か右側に線が
 * 生えてしまう。
 */
export function nodeWidth(text: string, depth: number): number {
  const tier = tierOf(depth);
  return Math.min(tier.maxWidth, Math.ceil(naturalWidth(text, tier.fontSize)));
}

/**
 * 折り返し後の行数を見積もる。明示的な改行も数える。
 * 実測（ResizeObserver）には頼らない：固定寸法を渡す構成では measured が
 * 入らないため、レイアウトと描画の両方がこの同じ関数を使う。
 *
 * 描画側は `width: max-content; max-width: <上限>` を当てるので、
 * 「上限に収まるなら折り返さない」という判定が実際の描画と一致する。
 */
export function estimateLineCount(text: string, depth: number): number {
  const tier = tierOf(depth);
  if (text.length === 0) return 1;
  if (naturalWidth(text, tier.fontSize) <= tier.maxWidth) {
    return text.split("\n").length;
  }
  let lines = 0;
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines += 1;
      continue;
    }
    let used = 0;
    let linesInParagraph = 1;
    for (const char of paragraph) {
      const width = charWidthEm(char) * tier.fontSize * SAFETY_MARGIN;
      if (used + width > tier.maxWidth) {
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
export function nodeHeight(text: string, depth: number): number {
  return estimateLineCount(text, depth) * tierOf(depth).lineHeight;
}

/** ノードが占める矩形の大きさ。 */
export interface NodeBox {
  width: number;
  height: number;
}

export function nodeBox(text: string, depth: number): NodeBox {
  return { width: nodeWidth(text, depth), height: nodeHeight(text, depth) };
}

/**
 * 計算に使う索引をまとめて作る。深さも大きさもノード集合から決まるので、
 * 1回の呼び出しで作って使い回す（ノードごとに祖先を辿り直さない）。
 */
interface LayoutContext {
  index: Map<ID | null, MindMapNode[]>;
  depths: Map<ID, number>;
}

function contextOf(nodes: MindMapNode[]): LayoutContext {
  return { index: buildChildIndex(nodes), depths: buildDepthIndex(nodes) };
}

function depthOf(ctx: LayoutContext, node: MindMapNode): number {
  return ctx.depths.get(node.id) ?? 0;
}

/** レイアウト計算で使うノードの高さ。 */
function heightOf(ctx: LayoutContext, node: MindMapNode): number {
  return nodeHeight(node.text, depthOf(ctx, node));
}

/**
 * 木全体を整列する。collapsed なノードは葉として扱い、その子孫の座標は動かさない。
 */
export function layoutTree(nodes: MindMapNode[]): MindMapNode[] {
  const ctx = contextOf(nodes);
  const { index } = ctx;
  const heights = new Map<ID, number>();

  const measure = (node: MindMapNode): number => {
    const own = heightOf(ctx, node);
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
    const height = heights.get(node.id) ?? heightOf(ctx, node);
    const x = depthToX(depth);
    const y = top + (height - heightOf(ctx, node)) / 2;
    if (node.x !== x || node.y !== y) patches.set(node.id, { x, y });
    if (node.collapsed) return;
    let cursor = top;
    for (const child of index.get(node.id) ?? []) {
      place(child, depth + 1, cursor);
      cursor += (heights.get(child.id) ?? heightOf(ctx, child)) + V_GAP;
    }
  };

  let rootTop = 0;
  for (const root of index.get(null) ?? []) {
    measure(root);
    place(root, 0, rootTop);
    rootTop += (heights.get(root.id) ?? heightOf(ctx, root)) + V_GAP;
  }
  return patchNodes(nodes, patches);
}

interface Bounds {
  top: number;
  bottom: number;
}

function boundsIn(ctx: LayoutContext, start: MindMapNode): Bounds {
  let top = start.y;
  let bottom = start.y + heightOf(ctx, start);
  const walk = (node: MindMapNode): void => {
    top = Math.min(top, node.y);
    bottom = Math.max(bottom, node.y + heightOf(ctx, node));
    if (node.collapsed) return;
    for (const child of ctx.index.get(node.id) ?? []) walk(child);
  };
  walk(start);
  return { top, bottom };
}

/** 表示されている部分木が占める縦方向の範囲。collapsed の先は数えない。 */
export function subtreeBounds(nodes: MindMapNode[], id: ID): Bounds {
  const ctx = contextOf(nodes);
  const start = getNode(nodes, id);
  if (!start) return { top: 0, bottom: 0 };
  return boundsIn(ctx, start);
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
 *
 * 積む位置は**親の中心**を軸にする（layoutTree と同じ考え方）。上端を保つと
 * 子が増えるたびに下だけへ伸びていき、親が子群の先頭に張り付いて
 * 上下非対称な木になる。親を動かさず子群のほうを中央へ寄せるので、
 * ルートは打っている最中に動かない。
 *
 * 親がいない（＝ルートたち）ときだけは軸が無いので、従来どおり上端を保つ。
 */
export function restackSiblings(nodes: MindMapNode[], parentId: ID | null): MindMapNode[] {
  const ctx = contextOf(nodes);
  const children = ctx.index.get(parentId) ?? [];
  if (children.length === 0) return nodes;

  const bounds = children.map((child) => boundsIn(ctx, child));
  let cursor = Math.min(...bounds.map((b) => b.top));
  const parent = getNode(nodes, parentId);
  if (parent) {
    const total =
      bounds.reduce((sum, b) => sum + (b.bottom - b.top), 0) + V_GAP * (children.length - 1);
    cursor = parent.y + heightOf(ctx, parent) / 2 - total / 2;
  }
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
 *
 * `pinnedId` を渡すと、そのノードだけは**絶対に動かさない**（先に確定させ、
 * 部分木を下げるときも除外する）。ドラッグの落とし先はユーザーが指した場所
 * なので、動かした本人ではなく被った相手のほうを下げるために使う。
 */
export function resolveOverlaps(nodes: MindMapNode[], pinnedId: ID | null = null): MindMapNode[] {
  const ctx = contextOf(nodes);
  const { index } = ctx;
  const pos = new Map<ID, { x: number; y: number }>();
  const size = new Map<ID, NodeBox>();
  for (const node of nodes) {
    pos.set(node.id, { x: node.x, y: node.y });
    size.set(node.id, nodeBox(node.text, depthOf(ctx, node)));
  }

  type Rect = { left: number; right: number; top: number; bottom: number };
  const placed: Rect[] = [];

  const rectOf = (id: ID): Rect => {
    const p = pos.get(id) ?? { x: 0, y: 0 };
    const box = size.get(id) ?? { width: 0, height: 0 };
    return { left: p.x, right: p.x + box.width, top: p.y, bottom: p.y + box.height };
  };

  /**
   * 部分木ごと下へずらす。折りたたまれた子孫も一緒に動かす。
   * 固定したノードだけは置いていく（その子孫は一緒に動かす）。
   */
  const shiftDown = (id: ID, dy: number): void => {
    const stack: ID[] = [id];
    while (stack.length > 0) {
      const current = stack.pop() as ID;
      const p = pos.get(current);
      if (p && current !== pinnedId) pos.set(current, { x: p.x, y: p.y + dy });
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
    // 固定したノードは先に確定させてあるので、ここでは位置を決め直さない。
    if (node.id !== pinnedId) {
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
    }
    if (node.collapsed) return;
    for (const child of index.get(node.id) ?? []) place(child);
  };

  // 固定するノードを最初に確定させる。以降はこれを避けて場所が決まる。
  if (pinnedId !== null && pos.has(pinnedId) && isVisible(nodes, pinnedId)) {
    placed.push(rectOf(pinnedId));
  }
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
 *
 * x は親の x からの固定間隔で決める（深さから直接求めない）。そうすると
 * ドラッグで動かした親の子が、離れた既定の列に飛ばない。同じ列にいる親は
 * x が揃っているので、結果として列も揃う。
 */
export function placeNewChild(nodes: MindMapNode[], parentId: ID | null): { x: number; y: number } {
  const parent = getNode(nodes, parentId);
  if (!parent) return { x: 0, y: 0 };
  const ctx = contextOf(nodes);
  const siblings = ctx.index.get(parent.id) ?? [];
  const x = parent.x + columnStep(depthOf(ctx, parent));
  if (siblings.length === 0) return { x, y: parent.y };
  const bottom = Math.max(...siblings.map((sibling) => boundsIn(ctx, sibling).bottom));
  return { x, y: bottom + V_GAP };
}

/**
 * 矢印キーの移動先。表示中のノードのうち、指定方向にあるもっとも近いノードを返す。
 * 主軸の距離に、軸ずれのペナルティ（2倍）を足した値で評価する。
 *
 * 横方向はノードの**左端**で比べる。幅がテキストの長さで変わるので、中心で
 * 比べると同じ列のノードどうしがずれて、上下移動の行き先が文字数で変わる。
 */
export function findNeighbor(
  visibleNodes: MindMapNode[],
  fromId: ID,
  direction: NavigateDirection,
): ID | null {
  const from = visibleNodes.find((node) => node.id === fromId);
  if (!from) return null;
  const ctx = contextOf(visibleNodes);
  const horizontal = direction === "left" || direction === "right";
  const sign = direction === "right" || direction === "down" ? 1 : -1;
  const anchor = (node: MindMapNode): { cx: number; cy: number } => ({
    cx: node.x,
    cy: node.y + heightOf(ctx, node) / 2,
  });
  const origin = anchor(from);

  let bestId: ID | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const node of visibleNodes) {
    if (node.id === fromId) continue;
    const c = anchor(node);
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
