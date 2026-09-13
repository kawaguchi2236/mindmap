/**
 * 「マップ全体を1枚に収める」ための出力サイズ計算（純関数・DOM に触らない）。
 *
 * CLAUDE.md §16 は「表示中のビューポートではなくマップ全体」を要求している。
 * そのため出力サイズは **ノードの外接矩形からだけ** 決める。現在のズーム倍率や
 * スクロール位置は一切入力に取らない（＝この関数の引数に存在しない）。
 */

/** キャンバス座標での矩形。React Flow の `Rect` と同じ形。 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** マップの外周に入れる余白（キャンバス座標）。ノードの影と選択枠が切れない程度。 */
export const EXPORT_PADDING = 48;

/**
 * 出力画像の 1 辺の上限（px）。
 *
 * ブラウザのキャンバス上限はエンジンごとに違い、Safari が最も厳しい。
 * 上限を超えると `toDataURL` が黙って空画像を返すため、超える前に縮小する。
 */
export const MAX_IMAGE_DIMENSION = 8192;

/** 出力画像の総ピクセル数の上限。Safari の約 16.7M に対して少し余裕を持たせる。 */
export const MAX_IMAGE_PIXELS = 16_000_000;

export interface ExportGeometryOptions {
  /** 余白（キャンバス座標）。既定 {@link EXPORT_PADDING}。 */
  padding?: number;
  /** 1 辺の上限（px）。既定 {@link MAX_IMAGE_DIMENSION}。 */
  maxDimension?: number;
  /** 総ピクセル数の上限。既定 {@link MAX_IMAGE_PIXELS}。 */
  maxPixels?: number;
}

export interface ExportGeometry {
  /** 出力画像の幅（px、1 以上の整数）。 */
  width: number;
  /** 出力画像の高さ（px、1 以上の整数）。 */
  height: number;
  /** キャンバス座標 → 出力 px の倍率。1 が等倍で、上限に当たったときだけ 1 未満。 */
  zoom: number;
  /** 上限に当たって縮小したか。true のときはユーザーに伝えること（黙って縮めない）。 */
  scaledDown: boolean;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 余白は 0 も正当な指定なので 0 を弾かない。 */
function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sizeOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 外接矩形から出力画像のサイズと倍率を決める。
 *
 * 等倍（zoom = 1）が基本で、上限に当たったときだけ全体を縮小する。
 * 切り詰め（クロップ）は行わない ＝ どの倍率でもマップ全体が必ず入る。
 */
export function computeExportGeometry(
  bounds: Rect,
  options: ExportGeometryOptions = {},
): ExportGeometry {
  const padding = nonNegativeOr(options.padding, EXPORT_PADDING);
  const maxDimension = positiveOr(options.maxDimension, MAX_IMAGE_DIMENSION);
  const maxPixels = positiveOr(options.maxPixels, MAX_IMAGE_PIXELS);

  // 余白を含めた「等倍で出したときの大きさ」。空のマップでも 1px は確保する。
  const naturalWidth = Math.max(1, sizeOf(bounds.width) + padding * 2);
  const naturalHeight = Math.max(1, sizeOf(bounds.height) + padding * 2);

  const byDimension = Math.min(maxDimension / naturalWidth, maxDimension / naturalHeight);
  const byPixels = Math.sqrt(maxPixels / (naturalWidth * naturalHeight));
  // 拡大はしない。上限に当たったぶんだけ縮める。
  const zoom = Math.min(1, byDimension, byPixels);

  return {
    // floor で丸める。round だと上限をちょうど 1px 超えることがある。
    width: Math.max(1, Math.floor(naturalWidth * zoom)),
    height: Math.max(1, Math.floor(naturalHeight * zoom)),
    zoom,
    scaledDown: zoom < 1,
  };
}

/** 縮小率を人に見せる文字列にする。例: 0.42 → "42%" */
export function formatScale(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return "0%";
  // 0 と表示して「出ていない」と誤解させないよう、下は 1% で止める。
  return `${Math.max(1, Math.round(zoom * 100))}%`;
}
