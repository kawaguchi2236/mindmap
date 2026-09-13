import { NextResponse } from "next/server";

import { getCurrentUser } from "@/features/auth/session";
import {
  deleteMapRequestSchema,
  putMapRequestSchema,
  type ConflictResponse,
} from "@/features/sync/protocol";
import {
  invalidRequest,
  logServerError,
  notFound,
  serverError,
  unauthorized,
} from "@/lib/server/api";
import {
  findNodeGraphProblem,
  getMap,
  softDeleteMap,
  upsertMap,
  type UpsertMapResult,
} from "@/lib/server/maps";

export const runtime = "nodejs";

/** Next.js 16 の App Router では動的セグメントが Promise で渡る。 */
type RouteContext = { params: Promise<{ id: string }> };

function conflict(serverMap: ConflictResponse["serverMap"]) {
  return NextResponse.json<ConflictResponse>(
    { error: "conflict", serverMap },
    { status: 409 },
  );
}

/** upsert / softDelete の結果を HTTP 応答に落とす（両者は同じ形を返す）。 */
function toResponse(result: UpsertMapResult) {
  if (result.ok) return NextResponse.json({ map: result.map });
  if (result.reason === "not_found") return notFound();
  return conflict(result.serverMap);
}

/** ボディを JSON として読む。壊れていれば null。 */
async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** マップ本体（ノード込み）を取得する。 */
export async function GET(_request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await context.params;
  try {
    const map = await getMap(user.id, id);
    if (map === null) return notFound();
    return NextResponse.json({ map });
  } catch (error) {
    logServerError("GET /api/maps/[id]", error);
    return serverError();
  }
}

/** 作成 or 更新。baseVersion による楽観ロック。衝突時は 409 + サーバ側の最新。 */
export async function PUT(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await context.params;

  const body = await readJson(request);
  if (body === null) {
    return invalidRequest("リクエストボディを JSON として解釈できません");
  }

  const parsed = putMapRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("リクエストボディの形式が不正です");
  }

  const { map, baseVersion } = parsed.data;
  if (map.id !== id) {
    return invalidRequest("URL の ID とボディの map.id が一致しません");
  }

  // 木構造として壊れた入力は、DB の制約違反（＝500）になる前にここで弾く。
  const problem = findNodeGraphProblem(map.nodes);
  if (problem !== null) return invalidRequest(problem);

  try {
    return toResponse(await upsertMap(user.id, map, baseVersion));
  } catch (error) {
    logServerError("PUT /api/maps/[id]", error);
    return serverError();
  }
}

/** 論理削除。物理削除はしない（CLAUDE.md §6）。 */
export async function DELETE(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const { id } = await context.params;

  const body = await readJson(request);
  if (body === null) {
    return invalidRequest("リクエストボディを JSON として解釈できません");
  }

  const parsed = deleteMapRequestSchema.safeParse(body);
  if (!parsed.success) {
    return invalidRequest("baseVersion を 0 以上の整数で指定してください");
  }

  try {
    return toResponse(
      await softDeleteMap(user.id, id, parsed.data.baseVersion),
    );
  } catch (error) {
    logServerError("DELETE /api/maps/[id]", error);
    return serverError();
  }
}
