import { z } from "zod";

/**
 * クラウド同期の通信フォーマット（クライアント／サーバ共有）。
 *
 * - 論理モデルは CLAUDE.md §7 に準拠する。
 * - 担当 A の `src/lib/model/types.ts` が main に入ったら、そちらを正とし
 *   このファイルは「ワイヤフォーマット（JSON 上の表現）」の定義に寄せる。
 *   日時はネットワーク上では ISO 8601 文字列で扱う。
 * - このファイルは同期エンジン（src/features/sync）と API ルート
 *   （src/app/api/maps）の共有契約。片方の都合だけで変更しない。
 */

export const ISO_DATE = z.string().datetime({ offset: true });

export const syncNodeSchema = z.object({
  id: z.string().min(1).max(64),
  parentId: z.string().min(1).max(64).nullable(),
  text: z.string().max(10_000),
  x: z.number().finite(),
  y: z.number().finite(),
  collapsed: z.boolean(),
  /** 同じ親の中での並び順 */
  order: z.number().int(),
  createdAt: ISO_DATE,
  updatedAt: ISO_DATE,
});

export const syncMapSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  /** サーバ側で単調増加する整数。楽観ロックに使う */
  version: z.number().int().nonnegative(),
  createdAt: ISO_DATE,
  updatedAt: ISO_DATE,
  /** 論理削除。null なら生存 */
  deletedAt: ISO_DATE.nullable(),
  nodes: z.array(syncNodeSchema).max(5_000),
});

export const mapSummarySchema = syncMapSchema
  .omit({ nodes: true })
  .extend({ nodeCount: z.number().int().nonnegative() });

export type SyncNode = z.infer<typeof syncNodeSchema>;
export type SyncMap = z.infer<typeof syncMapSchema>;
export type MapSummary = z.infer<typeof mapSummarySchema>;

/** PUT /api/maps/[id] のリクエストボディ */
export const putMapRequestSchema = z.object({
  map: syncMapSchema,
  /**
   * このクライアントが編集の土台にしたサーバ版数。
   * 未同期の新規マップは 0。サーバ側 version と一致しなければ 409。
   */
  baseVersion: z.number().int().nonnegative(),
});
export type PutMapRequest = z.infer<typeof putMapRequestSchema>;

/** DELETE /api/maps/[id] のリクエストボディ */
export const deleteMapRequestSchema = z.object({
  baseVersion: z.number().int().nonnegative(),
});

/** 409 応答。サーバ側の最新をそのまま返し、判断はクライアントに委ねる */
export type ConflictResponse = {
  error: "conflict";
  serverMap: SyncMap;
};

export type ApiErrorResponse = {
  error: "unauthorized" | "not_found" | "invalid_request" | "server_error";
  message?: string;
};

/**
 * エンドポイント一覧（実装は src/app/api/maps 配下）
 *
 * | メソッド | パス              | 用途 |
 * |---|---|---|
 * | GET    | /api/maps        | 自分のマップ要約一覧（論理削除分も含む。`?since=ISO` で差分取得） |
 * | GET    | /api/maps/[id]   | マップ本体（ノード込み） |
 * | PUT    | /api/maps/[id]   | 作成 or 更新（upsert）。baseVersion で楽観ロック |
 * | DELETE | /api/maps/[id]   | 論理削除。baseVersion で楽観ロック |
 *
 * 認証必須。他ユーザーのマップは 404 を返す（存在推測をさせない）。
 */
export const API_BASE = "/api/maps" as const;
