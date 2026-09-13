/**
 * 同期状態の表示文言。純粋関数のみ（現在時刻もブラウザ API も参照しない）。
 *
 * 文言をここに集めておくと、表示する画面が増えても言い回しがぶれない。
 * 同期は背景で走るものなので、成功時の主張は控えめにし、
 * 失敗時だけ「自動で再試行する」ことをはっきり伝える（CLAUDE.md §11, §29）。
 */

/** 同期ランナーの状態。`idle` は「まだ一度も走っていない」。 */
export type SyncPhase = "idle" | "offline" | "syncing" | "synced" | "failed";

export interface SyncStatusLabel {
  label: string;
  /** "normal" は補助テキスト色、"danger" は警告色で描く。 */
  tone: "normal" | "danger";
}

/**
 * 表示すべきラベル。出すものが無ければ null。
 *
 * `idle` で何も出さないのは、マウント直後の一瞬だけ「同期していません」と
 * 読める文言を見せないため。
 */
export function describeSyncPhase(phase: SyncPhase): SyncStatusLabel | null {
  switch (phase) {
    case "idle":
      return null;
    case "offline":
      // 操作はブロックしない。オフラインでも編集は続けられる（CLAUDE.md §12）。
      return { label: "オフライン — 接続が戻ったら同期します", tone: "normal" };
    case "syncing":
      return { label: "同期中…", tone: "normal" };
    case "synced":
      return { label: "同期済み", tone: "normal" };
    case "failed":
      // 失敗は伝えるが、ユーザーに操作を求めない。次の周期で自動的に再試行される。
      return { label: "同期に失敗しました（自動で再試行します）", tone: "danger" };
  }
}

/**
 * 競合コピーが作られたことの通知（ADR-005 §3.2 #10 / §3.3 #14）。
 * 両方を残したうえで、非破壊的に知らせるだけにとどめる。
 */
export function describeConflicts(count: number): string | null {
  if (count <= 0) return null;
  return `別の端末の変更と競合した ${count} 件は、コピーを作って両方を残しました。`;
}
