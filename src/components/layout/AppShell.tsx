"use client";

import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

export type AppShellVariant = "default" | "editor";

export interface AppShellProps {
  /** ふつうは <AppHeader />。省略すればヘッダー無しになる。 */
  header?: ReactNode;
  /** マップ一覧などで使う <Sidebar />。エディタでは渡さない。 */
  sidebar?: ReactNode;
  children: ReactNode;
  /**
   * `editor` はキャンバス用。画面を 100dvh に固定し、ヘッダーを重ねて
   * キャンバスの面積を削らない（CLAUDE.md §9）。
   */
  variant?: AppShellVariant;
  className?: string;
}

export function AppShell({
  header,
  sidebar,
  children,
  variant = "default",
  className,
}: AppShellProps) {
  const isEditor = variant === "editor";
  const classNames = [styles.shell, isEditor ? styles.editor : undefined, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classNames}>
      {header && !isEditor && header}

      <div className={styles.body}>
        {/* エディタではヘッダーを重ねる。キャンバスは全面のまま */}
        {header && isEditor && <div className={styles.overlayHeader}>{header}</div>}
        {sidebar}
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
