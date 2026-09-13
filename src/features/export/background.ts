/**
 * 出力画像の背景色を決める。
 *
 * CLAUDE.md §16 は背景を含めることを要求している。React Flow の
 * `.react-flow__viewport`（画像化の対象）自体は透明なので、背景色は
 * こちらで明示しないと透過 PNG になってしまう。
 *
 * 色はテーマトークン（`--color-canvas-bg`）に追従させたいが、CSS 変数を
 * 直接読むとダーク/ライトの解決規則をここに複製することになる。
 * 代わりに **実際に描かれている祖先の背景色** を計算済みスタイルから拾う。
 * これならライト・ダーク・OS 追従のどれでも自動的に正しい色になる。
 */

/** 祖先を辿っても色が決まらなかったときの保険（ライト側のキャンバス地色）。 */
export const FALLBACK_BACKGROUND_LIGHT = "#f3f2f2";

/** 同じくダーク側。`data-theme="dark"` または OS がダークのとき使う。 */
export const FALLBACK_BACKGROUND_DARK = "#1a1918";

/**
 * その色が「下が透けない色」かどうか。
 * 空文字・`transparent`・アルファ 0 は透けるので背景として採用しない。
 */
export function isOpaqueColor(color: string | null | undefined): boolean {
  if (!color) return false;
  const value = color.trim().toLowerCase();
  if (value === "" || value === "transparent" || value === "none") return false;

  const alpha = alphaOf(value);
  return alpha === null || alpha > 0;
}

/** アルファ値を 0〜1 で返す。アルファを持たない記法なら null。 */
function alphaOf(value: string): number | null {
  // #rrggbbaa / #rgba
  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (hex.length === 8) return Number.parseInt(hex.slice(6), 16) / 255;
    if (hex.length === 4) return Number.parseInt(hex.slice(3).repeat(2), 16) / 255;
    return null;
  }

  // rgba(r, g, b, a) と rgb(r g b / a) の両方の記法を見る。
  const functional = /^(?:rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!functional) return null;
  const body = functional[1];

  const slashed = body.split("/");
  if (slashed.length === 2) return parseAlpha(slashed[1]);

  const comma = body.split(",");
  if (comma.length === 4) return parseAlpha(comma[3]);
  return null;
}

function parseAlpha(raw: string): number | null {
  const text = raw.trim();
  const parsed = Number.parseFloat(text);
  if (!Number.isFinite(parsed)) return null;
  return text.endsWith("%") ? parsed / 100 : parsed;
}

/** `data-theme` と OS 設定から、保険として使う色を決める。 */
export function fallbackBackgroundColor(root: Element | null): string {
  const theme = root?.getAttribute("data-theme");
  if (theme === "dark") return FALLBACK_BACKGROUND_DARK;
  if (theme === "light") return FALLBACK_BACKGROUND_LIGHT;
  const prefersDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return prefersDark ? FALLBACK_BACKGROUND_DARK : FALLBACK_BACKGROUND_LIGHT;
}

/**
 * `element` から祖先を辿り、最初に見つかった不透明な背景色を返す。
 * 見つからなければテーマから決めた保険の色を返す（透明にはしない）。
 */
export function resolveBackgroundColor(element: Element | null): string {
  if (typeof window === "undefined") return FALLBACK_BACKGROUND_LIGHT;
  for (let current = element; current !== null; current = current.parentElement) {
    const color = window.getComputedStyle(current).backgroundColor;
    if (isOpaqueColor(color)) return color;
  }
  return fallbackBackgroundColor(element?.ownerDocument?.documentElement ?? null);
}
