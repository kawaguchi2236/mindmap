"use client";

import type { ReactNode } from "react";
import { Icon } from "../ui/Icon";
import styles from "./Sidebar.module.css";

export interface SidebarProps {
  open: boolean;
  onClose?: () => void;
  /** 上端の小さな見出し（mono・全大文字）。 */
  heading?: ReactNode;
  children: ReactNode;
  /** ランドマークのラベル。複数のナビゲーションがある画面では必ず付ける。 */
  label?: string;
  className?: string;
}

/**
 * マップ一覧側で使う開閉サイドバー。
 * エディタでは使わない（CLAUDE.md §9 — キャンバスの面積を削らない）。
 */
export function Sidebar({
  open,
  onClose,
  heading,
  children,
  label = "サイドバー",
  className,
}: SidebarProps) {
  const classNames = [styles.sidebar, open ? undefined : styles.closed, className]
    .filter(Boolean)
    .join(" ");

  return (
    <nav
      className={classNames}
      aria-label={label}
      // 閉じている間は中身をタブ移動の対象から外す。
      // 幅 0 の中に隠れたリンクへフォーカスが飛ぶのを防ぐ。
      inert={!open}
    >
      <div className={styles.inner}>
        {(heading !== undefined || onClose) && (
          <div className={styles.heading}>
            <span>{heading}</span>
            {onClose && (
              <button
                type="button"
                className={styles.close}
                onClick={onClose}
                aria-label="サイドバーを閉じる"
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </nav>
  );
}
