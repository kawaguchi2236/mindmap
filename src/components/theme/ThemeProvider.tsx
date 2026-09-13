"use client";

import { createContext, useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { isTheme, THEME_STORAGE_KEY } from "./types";
import type { ResolvedTheme, Theme } from "./types";

export interface ThemeContextValue {
  /** ユーザーの選択（`system` を含む）。 */
  theme: Theme;
  /** 実際に適用されている配色。ハイドレーション前は `light` を返す。 */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
  /**
   * クライアントでのハイドレーションが済んだか。
   * サーバー側では保存値も OS の設定も分からないので、
   * 「選択中」の表示はこれが true になってから出す。
   */
  mounted: boolean;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ------------------------------------------------------------------------
   localStorage を外部ストアとして購読する。
   useState + useEffect ではなく useSyncExternalStore を使うのは、
   保存値の読み取りが「レンダー後に state を書き戻す」形にならないようにするため。
   ------------------------------------------------------------------------ */

const themeListeners = new Set<() => void>();

/**
 * このタブでの最後の選択。
 * localStorage への書き込みが失敗する環境（プライベートウィンドウ、
 * サイトデータを止めた設定）でも、そのタブの間はテーマが効くようにする。
 */
let sessionTheme: Theme | null = null;

function emitThemeChange(): void {
  for (const listener of themeListeners) listener();
}

function subscribeTheme(onStoreChange: () => void): () => void {
  themeListeners.add(onStoreChange);

  // 別タブでの変更にも追従する。保存値のほうを正とするため、
  // このタブのメモリ上の選択は破棄する。
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    sessionTheme = null;
    onStoreChange();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    themeListeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * プライベートウィンドウやサイトデータを止めた設定では localStorage への
 * アクセス自体が例外を投げる。必ず try/catch で包み、未設定として扱う。
 * 戻り値は文字列（プリミティブ）なので、毎回読み直しても
 * useSyncExternalStore の同一性チェックは安定する。
 */
function getStoredTheme(): Theme | null {
  if (sessionTheme) return sessionTheme;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : null;
  } catch {
    return null;
  }
}

function getStoredThemeOnServer(): Theme | null {
  return null;
}

function writeStoredTheme(theme: Theme): void {
  sessionTheme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // 保存できなくても、そのタブの間は sessionTheme が効く。落とさない。
  }
}

/* ------------------------------------------------------------------------
   OS の配色設定の購読
   ------------------------------------------------------------------------ */

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystemDark(onStoreChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function getSystemDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches;
}

function getSystemDarkOnServer(): boolean {
  return false;
}

/* ------------------------------------------------------------------------ */

function noopSubscribe(): () => void {
  return () => {};
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    // 属性を消して globals.css の prefers-color-scheme に委ねる。
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", theme);
  }
}

export interface ThemeProviderProps {
  children: ReactNode;
  /** 保存済みの選択が無いときの既定値。 */
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = "system" }: ThemeProviderProps) {
  const storedTheme = useSyncExternalStore(subscribeTheme, getStoredTheme, getStoredThemeOnServer);
  const systemDark = useSyncExternalStore(
    subscribeSystemDark,
    getSystemDark,
    getSystemDarkOnServer,
  );
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  const theme = storedTheme ?? defaultTheme;

  // ThemeScript が描画前に付けた属性と React 側の値をここで合流させる。
  // 以降は setTheme が即座に DOM を更新するので、これは初回と
  // 別タブ由来の変更のための同期。
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    // DOM を先に変える。再レンダーを待たずに色が切り替わる。
    applyTheme(next);
    writeStoredTheme(next);
    emitThemeChange();
  }, []);

  const resolvedTheme: ResolvedTheme = useMemo(() => {
    if (theme === "system") {
      return systemDark ? "dark" : "light";
    }
    return theme;
  }, [theme, systemDark]);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme, mounted }),
    [theme, resolvedTheme, setTheme, mounted],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
