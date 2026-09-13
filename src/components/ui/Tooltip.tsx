"use client";

import { cloneElement, useCallback, useId, useState } from "react";
import type { KeyboardEvent, ReactElement, ReactNode } from "react";
import styles from "./Tooltip.module.css";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** 説明文。短く。 */
  content: ReactNode;
  /**
   * ツールチップを付ける要素。フォーカスできる要素（button / a / input など）に
   * 付けること。`aria-describedby` をここに差し込む。
   */
  children: ReactElement<{ "aria-describedby"?: string }>;
  placement?: TooltipPlacement;
  className?: string;
}

/**
 * hover と focus の両方で開く。
 * マウスが無いと読めないツールチップを作らないための最低条件で、
 * キーボード操作だけでも同じ情報に届く。
 * Esc で閉じられる（WCAG 1.4.13）。
 */
export function Tooltip({ content, children, placement = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tooltipId = `tooltip-${id}`;

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === "Escape") setOpen(false);
  }, []);

  // focus / blur は React 上でバブルするので、ラッパーで受けられる。
  return (
    <span
      className={[styles.wrap, className].filter(Boolean).join(" ")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={handleKeyDown}
    >
      {cloneElement(children, { "aria-describedby": tooltipId })}
      <span
        id={tooltipId}
        role="tooltip"
        data-open={open}
        className={`${styles.tip} ${styles[placement]}`}
      >
        {content}
      </span>
    </span>
  );
}
