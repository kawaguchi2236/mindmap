"use client";

import { useId } from "react";
import { useTheme } from "./useTheme";
import { THEMES } from "./types";
import type { Theme } from "./types";
import styles from "./ThemeToggle.module.css";

const LABELS: Record<Theme, string> = {
  light: "ライト",
  dark: "ダーク",
  system: "システム",
};

export interface ThemeToggleProps {
  /** ヘッダー用の小さめ表示。 */
  compact?: boolean;
  className?: string;
}

/**
 * ライト／ダーク／システムの3択。
 *
 * アイコンの循環ボタンにしていないのは、「いま何が選ばれているか」と
 * 「システム追従なのか明示指定なのか」が一目で分からなくなるため。
 * 実体は radio group なので、矢印キーでの選択はブラウザ任せで動く。
 */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme, mounted } = useTheme();
  const name = `theme-${useId()}`;

  const classNames = [styles.group, compact ? styles.compact : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames} role="group" aria-label="テーマ">
      {THEMES.map((value) => (
        <label
          key={value}
          className={styles.option}
          // マウント前は保存値が読めていないので、選択表示を出さない。
          data-selected={mounted && theme === value}
        >
          <input
            type="radio"
            className={styles.radio}
            name={name}
            value={value}
            checked={theme === value}
            onChange={() => setTheme(value)}
          />
          {LABELS[value]}
        </label>
      ))}
    </div>
  );
}
