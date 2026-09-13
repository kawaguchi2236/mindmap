import type { PoolClient } from "@neondatabase/serverless";

import type { MapSummary, SyncMap, SyncNode } from "@/features/sync/protocol";
import { sql, withTransaction } from "@/lib/server/db";

/**
 * マップのサーバ側リポジトリ。
 *
 * 方針:
 * - すべてのクエリに `user_id` 条件を付け、他ユーザーのデータには絶対に触れない。
 *   他人のマップは「存在しない」として扱う（存在推測をさせない）。
 * - `version` はサーバだけが進める。クライアントが送ってきた version は信用しない。
 * - 物理削除はしない。削除は `deleted_at` を立てるだけ（CLAUDE.md §6）。
 * - マップ本体とノードの入れ替えは必ず 1 トランザクションで行う。
 *   途中で失敗してもノードだけ消える状態を作らない。
 */

// ---------------------------------------------------------------------------
// 行 → ワイヤフォーマット変換
// ---------------------------------------------------------------------------

type MapRow = {
  id: string;
  title: string;
  version: number;
  created_at: unknown;
  updated_at: unknown;
  deleted_at: unknown;
};

type NodeRow = {
  id: string;
  parent_id: string | null;
  text: string;
  x: number;
  y: number;
  collapsed: boolean;
  order: number;
  created_at: unknown;
  updated_at: unknown;
};

/** timestamptz は driver 設定次第で Date にも文字列にもなるため、両方受ける。 */
function toIso(value: unknown): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string" || typeof value === "number"
        ? new Date(value)
        : null;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new Error("日時として解釈できない値が DB から返りました");
  }
  return date.toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function toSyncNode(row: NodeRow): SyncNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    text: row.text,
    x: row.x,
    y: row.y,
    collapsed: row.collapsed,
    order: row.order,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toSyncMap(row: MapRow, nodeRows: NodeRow[]): SyncMap {
  return {
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
    nodes: nodeRows.map(toSyncNode),
  };
}

const MAP_COLUMNS = "id, title, version, created_at, updated_at, deleted_at";
const NODE_COLUMNS =
  'id, parent_id, text, x, y, collapsed, "order", created_at, updated_at';

// ---------------------------------------------------------------------------
// 読み取り
// ---------------------------------------------------------------------------

/**
 * 自分のマップ要約一覧。
 *
 * 論理削除済みのマップも返す。クライアントは「サーバで消えた」ことを知らないと
 * ローカルの削除を反映できないため（差分同期に必要）。
 * `since` を渡すと、それ以降にサーバ側で更新されたものだけを返す。
 */
export async function listMapSummaries(
  userId: string,
  opts?: { since?: Date },
): Promise<MapSummary[]> {
  const since = opts?.since;
  const rows = since
    ? await sql`
        select m.id, m.title, m.version, m.created_at, m.updated_at, m.deleted_at,
               (select count(*) from nodes n where n.map_id = m.id)::int as node_count
        from maps m
        where m.user_id = ${userId}
          and m.updated_at > ${since.toISOString()}
        order by m.updated_at desc`
    : await sql`
        select m.id, m.title, m.version, m.created_at, m.updated_at, m.deleted_at,
               (select count(*) from nodes n where n.map_id = m.id)::int as node_count
        from maps m
        where m.user_id = ${userId}
        order by m.updated_at desc`;

  return (rows as (MapRow & { node_count: number })[]).map((row) => ({
    id: row.id,
    title: row.title,
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    deletedAt: toIsoOrNull(row.deleted_at),
    nodeCount: row.node_count,
  }));
}

/**
 * マップ本体（ノード込み）。
 * 他ユーザーのものと存在しないものは、どちらも区別せず null を返す。
 * 論理削除済みでも返す（クライアントが削除を取り込めるようにするため）。
 */
export async function getMap(
  userId: string,
  mapId: string,
): Promise<SyncMap | null> {
  const mapRows = (await sql`
    select id, title, version, created_at, updated_at, deleted_at
    from maps
    where id = ${mapId} and user_id = ${userId}`) as MapRow[];

  const row = mapRows[0];
  if (!row) return null;

  const nodeRows = (await sql`
    select id, parent_id, text, x, y, collapsed, "order", created_at, updated_at
    from nodes
    where map_id = ${mapId}
    order by parent_id nulls first, "order", id`) as NodeRow[];

  return toSyncMap(row, nodeRows);
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

export type UpsertMapResult =
  | { ok: true; map: SyncMap }
  | { ok: false; reason: "conflict"; serverMap: SyncMap }
  | { ok: false; reason: "not_found" };

export type SoftDeleteMapResult = UpsertMapResult;

/** 1 文あたりのノード挿入件数。Postgres のパラメータ上限（65535）に余裕を持たせる。 */
const NODE_INSERT_CHUNK = 200;

type LockedMapRow = { is_owner: boolean; version: number };

/**
 * 行ロックを取りつつ、所有者かどうかと現在の version を読む。
 *
 * 所有者判定は SQL 側（uuid 同士の比較）で行う。JS で文字列比較すると
 * uuid の表記ゆれで「他人のマップ」と誤判定しかねないため。
 */
async function lockMapRow(
  client: PoolClient,
  userId: string,
  mapId: string,
): Promise<LockedMapRow | null> {
  const result = await client.query<LockedMapRow>(
    `select (user_id = $2) as is_owner, version from maps where id = $1 for update`,
    [mapId, userId],
  );
  return result.rows[0] ?? null;
}

/** トランザクション内の最新状態を読み直す。呼び出し時点で行が存在することが前提。 */
async function loadMapInTx(
  client: PoolClient,
  userId: string,
  mapId: string,
): Promise<SyncMap> {
  const mapResult = await client.query<MapRow>(
    `select ${MAP_COLUMNS} from maps where id = $1 and user_id = $2`,
    [mapId, userId],
  );
  const row = mapResult.rows[0];
  if (!row) {
    throw new Error(`マップ ${mapId} を読み直せませんでした`);
  }
  const nodeResult = await client.query<NodeRow>(
    `select ${NODE_COLUMNS} from nodes where map_id = $1 order by parent_id nulls first, "order", id`,
    [mapId],
  );
  return toSyncMap(row, nodeResult.rows);
}

async function replaceNodes(
  client: PoolClient,
  mapId: string,
  nodes: SyncNode[],
): Promise<void> {
  // 全置換。DELETE と INSERT は同一トランザクション内なので、
  // 途中で失敗してもノードが消えたままにはならない。
  await client.query(`delete from nodes where map_id = $1`, [mapId]);

  for (let offset = 0; offset < nodes.length; offset += NODE_INSERT_CHUNK) {
    const chunk = nodes.slice(offset, offset + NODE_INSERT_CHUNK);
    const params: unknown[] = [mapId];
    const tuples = chunk.map((node) => {
      const base = params.length;
      params.push(
        node.id,
        node.parentId,
        node.text,
        node.x,
        node.y,
        node.collapsed,
        node.order,
        node.createdAt,
        node.updatedAt,
      );
      const placeholders = Array.from(
        { length: 9 },
        (_, i) => `$${base + 1 + i}`,
      ).join(", ");
      return `($1, ${placeholders})`;
    });

    await client.query(
      `insert into nodes (map_id, id, parent_id, text, x, y, collapsed, "order", created_at, updated_at)
       values ${tuples.join(", ")}`,
      params,
    );
  }
}

/**
 * 作成 or 更新。
 *
 * 楽観ロック:
 * - 既存行があり `version === baseVersion` のときだけ更新し、version を +1 する。
 * - 既存行が無い場合は `baseVersion === 0`（未同期の新規マップ）のときだけ作成し version = 1。
 * - version の値はサーバが決める。`map.version` は読まない。
 * - `updated_at` もサーバ時刻で上書きする。`?since=` の差分取得が
 *   クライアントの時計ずれで壊れないようにするため。
 */
export async function upsertMap(
  userId: string,
  map: SyncMap,
  baseVersion: number,
): Promise<UpsertMapResult> {
  return withTransaction(async (client): Promise<UpsertMapResult> => {
    const existing = await lockMapRow(client, userId, map.id);

    if (existing === null) {
      if (baseVersion !== 0) {
        // クライアントはサーバ版があると思っているが、サーバには無い。
        // 勝手に作り直さず 404 を返して、クライアントに判断させる。
        return { ok: false, reason: "not_found" };
      }
      const inserted = await client.query(
        `insert into maps (id, user_id, title, version, created_at, updated_at, deleted_at)
         values ($1, $2, $3, 1, $4, now(), $5)
         on conflict (id) do nothing
         returning id`,
        [map.id, userId, map.title, map.createdAt, map.deletedAt],
      );
      if (inserted.rows.length === 0) {
        // 同じ ID が同時に作られたか、他ユーザーがすでに持っている。
        const raced = await lockMapRow(client, userId, map.id);
        if (raced === null || !raced.is_owner) {
          return { ok: false, reason: "not_found" };
        }
        return {
          ok: false,
          reason: "conflict",
          serverMap: await loadMapInTx(client, userId, map.id),
        };
      }
    } else {
      if (!existing.is_owner) {
        return { ok: false, reason: "not_found" };
      }
      if (existing.version !== baseVersion) {
        return {
          ok: false,
          reason: "conflict",
          serverMap: await loadMapInTx(client, userId, map.id),
        };
      }
      await client.query(
        `update maps
            set title = $2,
                version = version + 1,
                updated_at = now(),
                deleted_at = $3
          where id = $1 and user_id = $4 and version = $5`,
        [map.id, map.title, map.deletedAt, userId, baseVersion],
      );
    }

    await replaceNodes(client, map.id, map.nodes);

    return { ok: true, map: await loadMapInTx(client, userId, map.id) };
  });
}

/**
 * 論理削除。`deleted_at` を立てて version を +1 するだけで、行もノードも残す。
 * すでに削除済みの場合は最初の削除時刻を保つ（再削除で履歴を塗り替えない）。
 */
export async function softDeleteMap(
  userId: string,
  mapId: string,
  baseVersion: number,
): Promise<SoftDeleteMapResult> {
  return withTransaction(async (client): Promise<SoftDeleteMapResult> => {
    const existing = await lockMapRow(client, userId, mapId);
    if (existing === null || !existing.is_owner) {
      return { ok: false, reason: "not_found" };
    }
    if (existing.version !== baseVersion) {
      return {
        ok: false,
        reason: "conflict",
        serverMap: await loadMapInTx(client, userId, mapId),
      };
    }

    await client.query(
      `update maps
          set deleted_at = coalesce(deleted_at, now()),
              updated_at = now(),
              version = version + 1
        where id = $1 and user_id = $2 and version = $3`,
      [mapId, userId, baseVersion],
    );

    return { ok: true, map: await loadMapInTx(client, userId, mapId) };
  });
}

// ---------------------------------------------------------------------------
// 入力の整合性チェック
// ---------------------------------------------------------------------------

/**
 * ノード集合の木構造としての整合性を検査する。問題があれば説明を、無ければ null。
 *
 * zod では表現できない関係の検査。DB の FK 制約でも重複や親不在は弾けるが、
 * COMMIT 時の例外（＝500）になってしまうため、書き込み前に 400 として返す。
 * 循環（a→b→a）は FK では検出できないのでここが唯一の防波堤。
 */
export function findNodeGraphProblem(nodes: SyncNode[]): string | null {
  const byId = new Map<string, SyncNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) {
      return `ノード ID が重複しています: ${node.id}`;
    }
    byId.set(node.id, node);
  }

  for (const node of nodes) {
    if (node.parentId === null) continue;
    if (node.parentId === node.id) {
      return `ノードが自分自身を親にしています: ${node.id}`;
    }
    if (!byId.has(node.parentId)) {
      return `親ノードが同じマップ内に見つかりません: ${node.id}`;
    }
  }

  // 根まで辿れたノードは settled に入れて再訪しない（全体で O(n)）。
  const settled = new Set<string>();
  for (const start of nodes) {
    if (settled.has(start.id)) continue;
    const path = new Set<string>();
    let cursor: SyncNode | undefined = start;
    while (cursor !== undefined && !settled.has(cursor.id)) {
      if (path.has(cursor.id)) {
        return `親子関係が循環しています: ${cursor.id}`;
      }
      path.add(cursor.id);
      cursor =
        cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
    for (const id of path) settled.add(id);
  }

  return null;
}
