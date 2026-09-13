import { NextResponse } from "next/server";

import { getCurrentUser } from "@/features/auth/session";
import type { MapSummary } from "@/features/sync/protocol";
import {
  invalidRequest,
  logServerError,
  serverError,
  unauthorized,
} from "@/lib/server/api";
import { listMapSummaries } from "@/lib/server/maps";

// Neon への接続と Auth.js のセッション参照があるため Node.js ランタイムで動かす。
export const runtime = "nodejs";

const SCOPE = "GET /api/maps";

/**
 * 自分のマップ要約一覧。論理削除済みも含む。
 * `?since=<ISO 8601>` を付けると、それ以降にサーバ側で更新されたものだけ返す。
 */
export async function GET(
  request: Request,
): Promise<NextResponse<{ maps: MapSummary[] } | { error: string }>> {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const sinceParam = new URL(request.url).searchParams.get("since");
  let since: Date | undefined;
  if (sinceParam !== null) {
    const parsed = new Date(sinceParam);
    if (Number.isNaN(parsed.getTime())) {
      return invalidRequest("since は ISO 8601 形式の日時で指定してください");
    }
    since = parsed;
  }

  try {
    const maps = await listMapSummaries(user.id, { since });
    return NextResponse.json({ maps });
  } catch (error) {
    logServerError(SCOPE, error);
    return serverError();
  }
}
