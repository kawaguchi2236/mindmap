"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface BaseButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 処理中。押せなくなり、スピナーが出る。 */
  loading?: boolean;
  /** ラベルの前に置くアイコン。 */
  startIcon?: ReactNode;
  /** ラベルの後ろに置くアイコン。 */
  endIcon?: ReactNode;
}

/**
 * アイコンだけのボタンは可視ラベルを持たないので、`aria-label` を型で必須にしている。
 * （目で見える文字が無いボタンは、読み上げでは無名のボタンになってしまう）
 */
type IconOnlyProps = BaseButtonProps & {
  iconOnly: true;
  "aria-label": string;
};

type LabelledProps = BaseButtonProps & {
  iconOnly?: false;
};

export type ButtonProps = IconOnlyProps | LabelledProps;

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  iconOnly = false,
  startIcon,
  endIcon,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    iconOnly ? styles.iconOnly : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classNames}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} /> : startIcon}
      {/* アイコンのみのボタンでは children がそのアイコンなので、
          読み込み中はスピナーだけに差し替える */}
      {!(iconOnly && loading) && children}
      {!loading && endIcon}
    </button>
  );
}
