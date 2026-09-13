"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import styles from "./Input.module.css";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  /** 可視ラベル。省略する場合は `aria-label` を必ず渡すこと。 */
  label?: ReactNode;
  /** 入力欄の左に置く小さなアイコン（装飾）。 */
  icon?: ReactNode;
  /** 補助テキスト。error があるときは error を優先して表示する。 */
  hint?: ReactNode;
  /** エラー文言。渡されると aria-invalid が立つ。 */
  error?: ReactNode;
  /** id を自分で決めたいとき。省略時は useId で自動生成する。 */
  inputId?: string;
  /** ラッパー要素に付けるクラス。 */
  className?: string;
}

export function Input({
  label,
  icon,
  hint,
  error,
  inputId,
  className,
  required,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const id = inputId ?? `input-${generatedId}`;
  const messageId = `${id}-message`;

  const hasError = Boolean(error);
  const message = error ?? hint;

  const wrapClassNames = [styles.field, className].filter(Boolean).join(" ");
  const inputWrapClassNames = [styles.inputWrap, hasError ? styles.invalid : undefined]
    .filter(Boolean)
    .join(" ");
  const messageClassNames = [styles.message, hasError ? styles.error : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={wrapClassNames}>
      {label !== undefined && (
        <label className={styles.label} htmlFor={id}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}

      <div className={inputWrapClassNames}>
        {icon && <span className={styles.icon}>{icon}</span>}
        <input
          id={id}
          className={styles.input}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={message !== undefined ? messageId : undefined}
          {...rest}
        />
      </div>

      {message !== undefined && (
        <p
          id={messageId}
          className={messageClassNames}
          // エラーは入力後に現れるので、読み上げにも変化を伝える
          role={hasError ? "alert" : undefined}
        >
          {message}
        </p>
      )}
    </div>
  );
}
