"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Modal.module.css";

export type ModalSize = "sm" | "md" | "lg";

export interface ModalProps {
  open: boolean;
  /** Esc・閉じるボタン・背景クリックのいずれでも呼ばれる。 */
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** 右下に並べるボタン列。 */
  footer?: ReactNode;
  size?: ModalSize;
  /** 右上の × を出さない（確認ダイアログ等で明示的な選択を促したいとき）。 */
  hideCloseButton?: boolean;
  /** 背景クリックで閉じない。 */
  disableBackdropClose?: boolean;
}

/**
 * ネイティブの `<dialog showModal()>` を使う。
 * これでフォーカストラップ・背景の inert 化・Esc での閉じる・top layer への配置が
 * ブラウザ側で担保されるので、自前でトラップを組む必要がない。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  hideCloseButton = false,
  disableBackdropClose = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // 開く直前にフォーカスがあった要素。閉じたらここへ戻す。
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        previouslyFocused.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();

        // 最初の操作対象にフォーカスを置く。
        // 見つからなければ dialog 自身（tabIndex=-1）に当てる。
        const focusable = dialog.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        (focusable ?? dialog).focus();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // 閉じたあとに呼び出し元へフォーカスを戻す。
  useEffect(() => {
    if (open) return;
    const target = previouslyFocused.current;
    previouslyFocused.current = null;
    // 要素がまだ DOM にある場合だけ戻す。
    if (target && target.isConnected) {
      target.focus();
    }
  }, [open]);

  // Esc・フォームの method="dialog" など、React を経由しない閉じ方も拾う。
  const handleClose = useCallback(() => {
    if (open) onClose();
  }, [open, onClose]);

  const handleBackdropClick = useCallback(
    (event: MouseEvent<HTMLDialogElement>) => {
      if (disableBackdropClose) return;
      // ::backdrop へのクリックは dialog 自身が target になる。
      if (event.target === dialogRef.current) onClose();
    },
    [disableBackdropClose, onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles[size]}`}
      aria-labelledby={titleId}
      tabIndex={-1}
      onClose={handleClose}
      onClick={handleBackdropClick}
    >
      <div className={styles.inner}>
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {!hideCloseButton && (
            <button type="button" className={styles.close} onClick={onClose} aria-label="閉じる">
              <Icon name="close" size={18} />
            </button>
          )}
        </div>

        <div className={styles.body}>{children}</div>

        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </dialog>
  );
}
