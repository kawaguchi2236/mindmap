"use client";

import { useContext } from "react";
import { ThemeContext } from "./ThemeProvider";
import type { ThemeContextValue } from "./ThemeProvider";

/**
 * テーマの現在値と切り替え関数。ThemeProvider の内側でのみ使える。
 */
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme は ThemeProvider の内側で呼ぶ必要があります。");
  }
  return context;
}
