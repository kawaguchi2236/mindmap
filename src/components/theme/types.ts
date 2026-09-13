/** ユーザーが選べるテーマ設定。`system` は OS の設定に追従する。 */
export type Theme = "light" | "dark" | "system";

/** 実際に適用されている配色。`system` は解決済みでここには現れない。 */
export type ResolvedTheme = "light" | "dark";

/** localStorage のキー。ThemeScript（インライン）と ThemeProvider で共有する。 */
export const THEME_STORAGE_KEY = "mindmap.theme";

export const THEMES: readonly Theme[] = ["light", "dark", "system"] as const;

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}
