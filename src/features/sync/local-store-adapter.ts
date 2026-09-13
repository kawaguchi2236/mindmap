import type { MapRepository } from "@/lib/db/types";
import type { MindMap, MindMapDocument, MindMapNode, SyncMeta, SyncState } from "@/lib/model/types";
import { SCHEMA_VERSION } from "@/lib/model/types";
import type { SyncMap, SyncNode } from "./protocol";
import type { LocalMapRecord, LocalStore } from "./types";

/**
 * 担当 A の `MapRepository` を同期エンジンの `LocalStore` ポートに繋ぐ薄い層。
 *
 * ここだけが両者の型を知っている。同期エンジン本体（`decide.ts` / `engine.ts`）は
 * IndexedDB も `MindMapDocument` も知らないまま、Node 上でテストできる
 * （CLAUDE.md §38「結合しない」）。
 *
 * 対応関係:
 * | LocalStore                | MapRepository                                |
 * |---|---|
 * | `listLocal()`             | `listMaps({ includeDeleted: true })` + 各件 `getMap` |
 * | `getLocal(id)`            | `getMap(id, { includeDeleted: true })`       |
 * | `putLocal(rec, opts)`     | `saveMapFromServer(doc, opts)` + `setSyncMeta` |
 * | `claimLocal(id, userId)`  | `claimMap(id, userId)`                       |
 * | `deleteLocalHard(id)`     | 対応なし（同期エンジンは呼ばない）           |
 */

export interface CreateLocalStoreOptions {
  /** テスト用の差し替え口。既定は現在時刻。 */
  now?: () => string;
}

export function createLocalStore(
  repository: MapRepository,
  options: CreateLocalStoreOptions = {},
): LocalStore {
  const now = options.now ?? (() => new Date().toISOString());

  async function read(id: string): Promise<LocalMapRecord | undefined> {
    const doc = await repository.getMap(id, { includeDeleted: true });
    if (!doc) return undefined;
    return toRecord(doc, await repository.getSyncMeta(id));
  }

  return {
    async listLocal(): Promise<LocalMapRecord[]> {
      // 墓標も含めた全件。サーバ側の削除と突き合わせるのに必要。
      const summaries = await repository.listMaps({ includeDeleted: true });
      const records: LocalMapRecord[] = [];
      for (const summary of summaries) {
        // MindMapSummary には version もノードも入っていないので本体を読む。
        // Phase 1 の規模（1 ユーザーあたり数十マップ）では素直に読んで問題ない。
        const record = await read(summary.id);
        // 一覧取得と本体読み込みの間に消えていたら、その 1 件だけ飛ばす。
        if (record) records.push(record);
      }
      return records;
    },

    getLocal: read,

    async putLocal(record, opts): Promise<void> {
      // version も updatedAt も進めない経路を使う。サーバが確定した値を正とするため。
      await repository.saveMapFromServer(toDocument(record), opts);
      await repository.setSyncMeta(toSyncMeta(record, now()));
    },

    async claimLocal(mapId: string, userId: string): Promise<void> {
      // 所有者を立てるだけ。version も updatedAt もノードも動かない。
      await repository.claimMap(mapId, userId);
    },

    async deleteLocalHard(id: string): Promise<never> {
      // 同期エンジンはこの経路を使わない（論理削除で止める）。
      // 呼ばれたらバグなので、黙って何かを消すのではなく明示的に失敗させる。
      throw new Error(
        `物理削除は同期の責務ではありません（${id}）。論理削除は deleteMap を使ってください。`,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------

/** `MindMapDocument` + `SyncMeta` → 同期エンジンのレコード。 */
export function toRecord(doc: MindMapDocument, meta: SyncMeta | null): LocalMapRecord {
  return {
    map: toSyncMap(doc),
    userId: doc.map.userId,
    syncedVersion: meta?.lastSyncedVersion ?? 0,
    dirty: meta?.state === "pending",
  };
}

/** ワイヤ表現（ノード込み）へ。`userId` は `MindMap` 側の持ち物なので落とす。 */
export function toSyncMap(doc: MindMapDocument): SyncMap {
  return {
    id: doc.map.id,
    title: doc.map.title,
    version: doc.map.version,
    createdAt: doc.map.createdAt,
    updatedAt: doc.map.updatedAt,
    deletedAt: doc.map.deletedAt,
    nodes: doc.nodes.map(toSyncNode),
  };
}

function toSyncNode(node: MindMapNode): SyncNode {
  // mapId はワイヤ表現には無い（マップ本体に属するので自明）。
  return {
    id: node.id,
    parentId: node.parentId,
    text: node.text,
    x: node.x,
    y: node.y,
    collapsed: node.collapsed,
    order: node.order,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

/** 同期エンジンのレコード → 保存用ドキュメント。 */
export function toDocument(record: LocalMapRecord): MindMapDocument {
  const map: MindMap = {
    id: record.map.id,
    userId: record.userId,
    title: record.map.title,
    createdAt: record.map.createdAt,
    updatedAt: record.map.updatedAt,
    deletedAt: record.map.deletedAt,
    version: record.map.version,
  };
  const nodes: MindMapNode[] = record.map.nodes.map((node) => ({
    ...node,
    // ノードの所属先を復元する。競合コピーでは新しいマップ ID になる。
    mapId: record.map.id,
  }));
  return { schemaVersion: SCHEMA_VERSION, map, nodes };
}

/** 同期エンジンのレコード → 同期メタ情報。 */
export function toSyncMeta(record: LocalMapRecord, at: string): SyncMeta {
  const synced = record.syncedVersion > 0;
  const state: SyncState = record.dirty ? "pending" : synced ? "synced" : "local-only";
  return {
    mapId: record.map.id,
    state,
    // 同期エンジンが putLocal を呼ぶのは「サーバと一致させた」瞬間だけ。
    lastSyncedAt: synced ? at : null,
    lastSyncedVersion: synced ? record.syncedVersion : null,
    lastError: null,
  };
}
