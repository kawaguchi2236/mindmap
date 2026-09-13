/**
 * マップ一覧の表示整形。すべて純粋関数（副作用・現在時刻の暗黙参照なし）。
 *
 * 現在時刻を引数で受け取るのは、テストを決定的にするためだけでなく、
 * サーバ描画とクライアント描画で違う時刻が混ざってハイドレーション不一致を
 * 起こさないようにするためでもある。呼び出し側は必ずマウント後に確定した
 * 1つの `now` を渡すこと（MapListScreen.tsx を参照）。
 */

import type { ISODateString, SyncState } from "@/lib/model/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 更新日時を「3分前」のような相対表記にする。7日以上前は絶対日付。
 *
 * 端末の時計がずれていて未来の日時が来ることがあるため、負の差分は
 * 「たった今」に丸める（「-3分前」を見せない）。
 */
export function formatRelativeTime(iso: ISODateString, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "日時不明";

  const diff = now.getTime() - then;
  if (diff < MINUTE) return "たった今";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}時間前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}日前`;

  // toLocaleDateString は環境によって書式が変わるので使わない（表示のぶれを避ける）。
  const date = new Date(then);
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

/** 一覧行に出す同期状態のラベル。出すべきものが無ければ null。 */
export interface SyncBadge {
  label: string;
  /** "normal" は補助テキスト色、"danger" は警告色で描く。 */
  tone: "normal" | "danger";
}

/**
 * 同期状態のラベル。
 *
 * ゲストは同期の概念自体が無いので、何も出さない（CLAUDE.md §14：
 * ログインしていないことを欠陥のように見せない）。
 */
export function describeSyncState(state: SyncState, signedIn: boolean): SyncBadge | null {
  if (!signedIn) return null;
  switch (state) {
    case "synced":
      return { label: "同期済み", tone: "normal" };
    case "pending":
      return { label: "同期待ち", tone: "normal" };
    case "failed":
      return { label: "同期できません", tone: "danger" };
    case "local-only":
      return { label: "この端末のみ", tone: "normal" };
  }
}

/** 一覧の通し番号（01, 02, ... 10）。ハンドオフ `#2c` の mono 表記。 */
export function formatIndex(zeroBasedIndex: number): string {
  return String(zeroBasedIndex + 1).padStart(2, "0");
}

// ---------------------------------------------------------------------------
// エラー文言
// ---------------------------------------------------------------------------

export type MapsOperation = "load" | "create" | "rename" | "delete" | "restore";

const OPERATION_TEXT: Record<MapsOperation, string> = {
  load: "マップ一覧を読み込めませんでした。",
  create: "新しいマップを作成できませんでした。",
  rename: "マップの名前を変更できませんでした。",
  delete: "マップを削除できませんでした。",
  restore: "削除を取り消せませんでした。",
};

/**
 * 原因ごとの補足。`src/lib/db/errors.ts` の `name` で分岐する。
 * `instanceof` を使わないのは、同じクラスでもバンドル境界で別実体になりうるため。
 */
const CAUSE_TEXT: Record<string, string> = {
  IndexedDbUnavailableError:
    "このブラウザではデータをローカルに保存できません。プライベートウィンドウを閉じるか、別のブラウザでお試しください。",
  UnsupportedSchemaVersionError:
    "保存されているデータがこのアプリより新しい形式です。ページを再読み込みしてアプリを更新してください。",
  MapNotFoundError: "対象のマップが見つかりませんでした。一覧を再読み込みしてください。",
  StaleWriteError:
    "別のタブでこのマップが更新されています。一覧を再読み込みしてからやり直してください。",
};

/**
 * 画面に出すエラー文言を作る。
 *
 * CLAUDE.md §29：黙って失敗させない。ただし生のスタックトレースやライブラリの
 * 例外メッセージはそのまま出さない（利用者には意味がなく、不安だけ与えるため）。
 */
export function describeMapsError(error: Error, operation: MapsOperation): string {
  const cause = CAUSE_TEXT[error.name] ?? "しばらくしてからもう一度お試しください。";
  return `${OPERATION_TEXT[operation]}${cause}`;
}
