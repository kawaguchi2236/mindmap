"use client";

import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import { ThemeToggle } from "../theme/ThemeToggle";
import styles from "./AppHeader.module.css";

export interface AppHeaderProps {
  /** ブランド名、またはマップ名。 */
  title?: ReactNode;
  /** 保存・同期状態などの短いメタ表記（mono・全大文字で表示される）。 */
  subtitle?: ReactNode;
  /**
   * 右側に差し込む要素。アカウントメニュー・PNG 書き出し・Undo/Redo など、
   * 画面ごとに違うものはここから渡す。テーマ切替はヘッダー側が常に持つ。
   */
  actions?: ReactNode;
  /** サイドバーの開閉ボタンを出す。渡さなければボタン自体を描かない。 */
  onMenuClick?: () => void;
  /** サイドバーが開いているか（メニューボタンの aria-expanded に使う）。 */
  menuExpanded?: boolean;
  /** 罫線と地色を消す。エディタでキャンバスに溶かしたいとき。 */
  transparent?: boolean;
  /** テーマ切替を出さない（設定画面など、本文側に置く場合）。 */
  hideThemeToggle?: boolean;
  className?: string;
}

export function AppHeader({
  title,
  subtitle,
  actions,
  onMenuClick,
  menuExpanded,
  transparent = false,
  hideThemeToggle = false,
  className,
}: AppHeaderProps) {
  const classNames = [styles.header, transparent ? styles.transparent : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={classNames}>
      <div className={styles.left}>
        {onMenuClick && (
          <button
            type="button"
            className={styles.menuButton}
            onClick={onMenuClick}
            aria-label={menuExpanded ? "サイドバーを閉じる" : "サイドバーを開く"}
            aria-expanded={menuExpanded}
          >
            <Icon name="menu" size={18} />
          </button>
        )}
        <span className={styles.mark} aria-hidden="true" />
        {title !== undefined && <span className={styles.title}>{title}</span>}
        {subtitle !== undefined && <span className={styles.subtitle}>{subtitle}</span>}
      </div>

      <div className={styles.right}>
        {actions}
        {!hideThemeToggle && <ThemeToggle compact />}
      </div>
    </header>
  );
}
