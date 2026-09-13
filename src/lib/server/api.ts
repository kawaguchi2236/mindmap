import { NextResponse } from "next/server";

import type { ApiErrorResponse } from "@/features/sync/protocol";

/**
 * API ルート共通のエラー応答ヘルパ。
 * 形は protocol.ts の ApiErrorResponse に固定する（クライアントが分岐できるように）。
 */

function apiError(
  error: ApiErrorResponse["error"],
  status: number,
  message?: string,
): NextResponse<ApiErrorResponse> {
  return NextResponse.json(
    message === undefined ? { error } : { error, message },
    { status },
  );
}

export const unauthorized = () => apiError("unauthorized", 401);

/** 存在しないマップと他ユーザーのマップは区別せず 404。存在を推測させない。 */
export const notFound = () => apiError("not_found", 404);

export const invalidRequest = (message?: string) =>
  apiError("invalid_request", 400, message);

export const serverError = () => apiError("server_error", 500);

/**
 * 想定外の例外をログに残す。
 *
 * スタックトレースも生の例外オブジェクトも出さない（CLAUDE.md §29）。
 * Neon の例外は接続情報を含むことがあるため、message だけに絞る。
 */
export function logServerError(scope: string, error: unknown): void {
  console.error(
    `[${scope}] 処理に失敗しました:`,
    error instanceof Error ? error.message : "不明なエラー",
  );
}
