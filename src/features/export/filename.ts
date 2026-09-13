/**
 * マップのタイトルから保存ファイル名を作る（純関数）。
 *
 * タイトルはユーザーが自由に打てるので、そのままでは
 * 「空」「`/` を含む」「Windows の予約名」「長すぎる」のどれでも壊れる。
 * ここで必ず安全な名前に落としてから `<a download>` に渡す。
 */

/** タイトルが使えないときの既定名。 */
export const DEFAULT_EXPORT_BASENAME = "mindmap";

/** 拡張子を除いた最大長（コードポイント数）。長いタイトルは末尾を落とす。 */
export const MAX_BASENAME_LENGTH = 80;

/**
 * Windows が禁止する記号。macOS/Linux で禁止なのは `/` だけだが、
 * 厳しい側に合わせておけばどの OS でも壊れない。
 */
const FORBIDDEN_SYMBOLS = '<>:"/\\|?*';

/** Windows の予約デバイス名。拡張子を付けても予約のままなので前置きして避ける。 */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** 制御文字（DEL を含む）と禁止記号はファイル名に置けない。 */
function isForbidden(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) return true;
  return FORBIDDEN_SYMBOLS.includes(char);
}

/**
 * タイトルを安全なベース名（拡張子なし）に変換する。
 * 変換の結果が空になった場合は {@link DEFAULT_EXPORT_BASENAME} を返す。
 */
export function toSafeBaseName(title: string | null | undefined): string {
  const cleaned = [...(title ?? "")]
    // 絵文字などのサロゲートペアを途中で割らないようコードポイント単位で扱う。
    .map((char) => (isForbidden(char) ? " " : char))
    .join("")
    // 改行・タブ・連続空白を 1 つの半角空白へ潰す。
    .replace(/\s+/g, " ")
    .trim();

  const truncated = [...cleaned].slice(0, MAX_BASENAME_LENGTH).join("");

  // 先頭・末尾のドットと空白を落とす（"..." だけの名前や隠しファイル化を防ぐ）。
  const trimmed = truncated.replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");

  if (trimmed === "") return DEFAULT_EXPORT_BASENAME;
  if (RESERVED_NAMES.test(trimmed)) return `_${trimmed}`;
  return trimmed;
}

/** タイトルから `<タイトル>.png` を作る。 */
export function toPngFileName(title: string | null | undefined): string {
  return `${toSafeBaseName(title)}.png`;
}
