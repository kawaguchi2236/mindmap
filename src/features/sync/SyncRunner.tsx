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
 *
 * エディタに置くときは `showStatus={false}` を使う。キャンバスの上に
 * 常駐する文字列を増やさないため（§9 / §17）。同期は変わらず回る。
 */

import { useCurrentUser } from "@/features/auth/useCurrentUser";
import { describeConflicts, describeSyncPhase } from "./status";
import { useSyncRunner } from "./useSyncRunner";
import type { LocalStore, RemoteClient } from "./types";
import styles from "./SyncRunner.module.css";

export interface SyncRunnerProps {
  /**
   * ログイン中のユーザー ID。ゲストは null。
   *
   * null は異常ではなく通常の状態で、そのときは通信も描画も一切起きない。
   *
   * **省略した場合**はクライアント側のセッション（`useCurrentUser()`）から引く。
   * サーバで本人を確定できる画面（`/maps`・`/settings`）は、そちらの値を
   * そのまま渡すこと — 余分な問い合わせを待たずに同期を始められる。
   */
  userId?: string | null;
  className?: string;
  /**
   * 同期状態の 1 行表示を出すか。既定は出す。
   * false にすると同期だけ回り、DOM には何も足さない。
   */
  showStatus?: boolean;
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
  showStatus = true,
  onLocalChanged,
  local,
  remote,
  intervalMs,
}: SyncRunnerProps) {
  const session = useCurrentUser();
  /*
   * 明示的に渡された値が優先。`null`（＝ゲストだと呼び出し側が知っている）と
   * 省略（＝セッションに聞く）を取り違えないよう、undefined だけで分岐する。
   * セッションを問い合わせ中は null、つまりゲストと同じで何もしない。
   * 確定したら userId が変わり、そこで同期が走り出す。
   */
  const effectiveUserId = userId !== undefined ? userId : (session.user?.id ?? null);

  const state = useSyncRunner({
    userId: effectiveUserId,
    intervalMs,
    local,
    remote,
    onLocalChanged,
  });

  // フックは必ず呼んでから分岐する（同期そのものはフック側がゲストで止めている）。
  if (!showStatus) return null;
  if (effectiveUserId === null) return null;

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
