/**
 * エラー監視（CLAUDE.md §29 / §30 / §31）。
 *
 * 方針:
 * - **エラーメッセージ本文は送らない。** 送るのはエラーの種類名・発生箇所ラベル・
 *   スタックの「フレーム行」だけ。メッセージは文字列連結で作られるものなので、
 *   ノード本文やメールアドレスが混ざる経路になりうる。構造的に混ざらない形にしておく
 *   （フィルタで頑張るのではなく、そもそも通さない）。
 * - **生のスタックトレースを利用者に見せない。** ここは送信するだけで、画面には何も出さない。
 * - 送信先が未設定なら何もしない。失敗してもアプリに影響させない（sink.ts）。
 */

import { sendError } from "./sink";

/** どこで起きたエラーか。自由記述にしないための固定の語彙。 */
export type ErrorContext =
  "global" | "unhandled-rejection" | "editor" | "persistence" | "sync" | "export" | "auth";

/** 送信する1件の形。メッセージ本文のフィールドは**意図的に存在しない**。 */
export interface ErrorReport {
  readonly name: string;
  readonly where: ErrorContext;
  readonly frames: readonly string[];
  readonly at: number;
}

/** 送るフレーム数の上限。多くても原因は先頭で分かる。 */
const MAX_FRAMES = 10;
/** 1フレームの長さの上限。 */
const MAX_FRAME_LENGTH = 200;

/**
 * スタックの「フレーム行」だけを残す。
 *
 * V8 は 1 行目が `Error: メッセージ` で、以降が `    at fn (file:1:2)`。
 * Safari にメッセージ行は無く、`fn@file:1:2` の形。
 * どちらの**フレームの形にも当てはまらない行は捨てる**ので、メッセージ行は残らない。
 */
const FRAME_LINE = /^\s*at\s|^\S*@\S+:\d+:\d+/;

function sanitizeStack(stack: unknown): string[] {
  if (typeof stack !== "string") return [];
  return stack
    .split("\n")
    .filter((line) => FRAME_LINE.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => line.trim().slice(0, MAX_FRAME_LENGTH));
}

/**
 * エラーの種類名。`Error` / `TypeError` / 自作クラス名などの識別子で、
 * 利用者が書いた内容は入らない。
 */
function errorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === "string" && error.name.length > 0) {
    return error.name.slice(0, 100);
  }
  // Error 以外が投げられた場合。中身は何でもありうるので**一切見ない**。
  return "NonError";
}

/**
 * エラーを1件報告する。**例外を投げない。**
 *
 * 画面への表示はしない。利用者向けの文言は、呼び出し側の画面が自分で出すこと（§29）。
 */
export function reportError(error: unknown, where: ErrorContext = "global"): void {
  try {
    const report: ErrorReport = {
      name: errorName(error),
      where,
      frames: sanitizeStack(error instanceof Error ? error.stack : undefined),
      at: Date.now(),
    };
    sendError(report);
  } catch {
    // 監視が原因でアプリを壊さない。
  }
}

let uninstall: (() => void) | null = null;

/**
 * 拾い損ねた例外と Promise の reject を拾う。
 *
 * 二重に登録しても増えない。戻り値を呼ぶと解除する（React の effect 用）。
 */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === "undefined") return () => {};
  if (uninstall !== null) return uninstall;

  const onError = (event: ErrorEvent) => {
    // event.message は文字列なので使わない。Error 本体だけを見る。
    reportError(event.error, "global");
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, "unhandled-rejection");
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  uninstall = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    uninstall = null;
  };
  return uninstall;
}
