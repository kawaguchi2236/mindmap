"use client";

/**
 * クラウド同期を「マウントされている間だけ」回す小さな部品。
 *
 * 置いた画面でだけ同期が動く。エディタでも動かすには、アプリ全体を包む
 * レイアウト（`src/app/layout.tsx`）に置く必要がある。
 *
 * UI はほぼ持たない。出すのは 1 行の状態表示だけで、
 * ゲストのときは何も描画しない（ログインしていないことを欠陥のように見せない、
 * CLAUDE.md §14）。同期は背景の仕事であって、画面の主役ではない（§9, §17）。
 */

import { describeConflicts, describeSyncPhase } from "./status";
import { useSyncRunner } from "./useSyncRunner";
import type { LocalStore, RemoteClient } from "./types";
import styles from "./SyncRunner.module.css";

export interface SyncRunnerProps {
  /**
   * ログイン中のユーザー ID。ゲストは null。
   *
   * null は異常ではなく通常の状態で、そのときは通信も描画も一切起きない。
   */
  userId: string | null;
  className?: string;
  /** 同期でローカルの内容が変わったときに呼ばれる（一覧の再読み込みなど）。 */
  onLocalChanged?: () => void;
  /** テスト用の差し替え口。本番では渡さない。 */
  local?: LocalStore;
  remote?: RemoteClient;
  intervalMs?: number;
}

export function SyncRunner({
  userId,
  className,
  onLocalChanged,
  local,
  remote,
  intervalMs,
}: SyncRunnerProps) {
  const state = useSyncRunner({ userId, intervalMs, local, remote, onLocalChanged });

  // フックは必ず呼んでから分岐する（同期そのものはフック側がゲストで止めている）。
  if (userId === null) return null;

  const status = describeSyncPhase(state.phase);
  if (status === null) return null;
  const conflicts = describeConflicts(state.conflictCount);

  return (
    /*
     * aria-live は polite。同期は背景の出来事なので、
     * スクリーンリーダーの読み上げに割り込ませない（CLAUDE.md §9 の精神）。
     */
    <p
      role="status"
      aria-live="polite"
      className={className === undefined ? styles.status : `${styles.status} ${className}`}
    >
      <span className={status.tone === "danger" ? styles.danger : undefined}>{status.label}</span>
      {conflicts !== null && <span className={styles.conflict}>{conflicts}</span>}
    </p>
  );
}
