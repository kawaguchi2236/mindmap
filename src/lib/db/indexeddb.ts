/**
 * MapRepository の IndexedDB 実装（CLAUDE.md §5 ローカルファースト / §6 データ安全）。
 *
 * ストア構成
 * - `maps`     key = map.id  … MindMap のメタ情報（+ 一覧用の nodeCount / schemaVersion）
 * - `nodes`    key = map.id  … { mapId, nodes } でマップ丸ごと1レコード
 * - `syncMeta` key = mapId   … SyncMeta
 *
 * maps と nodes を分けているのは、一覧表示でノード本体を読まずに済ませるため。
 * ただし書き込みは必ず両ストアを1トランザクションで行い、
 * 「マップだけ保存されてノードが古い」状態を構造的に作らない。
 */

import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import {
  SCHEMA_VERSION,
  type ID,
  type MindMap,
  type MindMapDocument,
  type MindMapNode,
  type MindMapSummary,
  type SyncMeta,
  type SyncState,
} from "@/lib/model/types";
import { createMapDocument, now } from "@/lib/model/factory";
import type { MapRepository } from "./types";
import {
  IndexedDbUnavailableError,
  InvalidDocumentError,
  MapNotFoundError,
  StaleWriteError,
  UnsupportedSchemaVersionError,
  toError,
} from "./errors";

// ---------------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------------

export const DB_NAME = "web-mindmap";

/**
 * IndexedDB のスキーマ版。ストア／インデックスを足したときだけ +1 し、
 * upgrade には「その版で追加するもの」だけを書く（既存データを消さない）。
 */
export const DB_VERSION = 1;

/**
 * maps ストアに入る値。MindMap の上位互換で、一覧表示に必要な
 * nodeCount と、読み込み時の安全確認に使う schemaVersion を足しただけ。
 */
interface StoredMap extends MindMap {
  nodeCount: number;
  schemaVersion: number;
}

interface StoredNodes {
  mapId: ID;
  nodes: MindMapNode[];
}

interface MindMapDb extends DBSchema {
  maps: {
    key: ID;
    value: StoredMap;
    indexes: { updatedAt: string; userId: string; deletedAt: string };
  };
  nodes: { key: ID; value: StoredNodes };
  syncMeta: { key: ID; value: SyncMeta };
}

type StoreName = "maps" | "nodes" | "syncMeta";

// ---------------------------------------------------------------------------
// 接続
// ---------------------------------------------------------------------------

let dbPromise: Promise<IDBPDatabase<MindMapDb>> | null = null;

/**
 * DB を開く（接続は使い回す）。
 * IndexedDB が無い／開けない環境では IndexedDbUnavailableError を投げる。
 */
export async function openMindMapDb(): Promise<IDBPDatabase<MindMapDb>> {
  if (typeof indexedDB === "undefined") {
    throw new IndexedDbUnavailableError(
      "この環境には IndexedDB がありません（サーバー側、またはストレージ無効）。",
    );
  }

  if (!dbPromise) {
    dbPromise = openDB<MindMapDb>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // 各ブロックは「その版で新しく追加するもの」だけ。
        // 既存ストアの削除・クリアは絶対に行わない（CLAUDE.md §6）。
        if (oldVersion < 1) {
          const maps = db.createObjectStore("maps", { keyPath: "id" });
          maps.createIndex("updatedAt", "updatedAt");
          maps.createIndex("userId", "userId");
          maps.createIndex("deletedAt", "deletedAt");

          db.createObjectStore("nodes", { keyPath: "mapId" });
          db.createObjectStore("syncMeta", { keyPath: "mapId" });
        }
      },
      blocking() {
        // 別タブがスキーマを上げようとしている。接続を手放して進ませる。
        void closeMindMapDb();
      },
      terminated() {
        dbPromise = null;
      },
    });

    // 開けなかった場合は次回やり直せるように接続をリセットしてから投げ直す。
    dbPromise = dbPromise.catch((error: unknown) => {
      dbPromise = null;
      throw new IndexedDbUnavailableError(
        "IndexedDB を開けませんでした。プライベートウィンドウやストレージ制限の可能性があります。",
        { cause: toError(error) },
      );
    });
  }

  return dbPromise;
}

/** 接続を閉じる（タブ間のスキーマ更新・テストのリセット用）。 */
export async function closeMindMapDb(): Promise<void> {
  const pending = dbPromise;
  dbPromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // すでに閉じている場合は何もしない。
  }
}

// ---------------------------------------------------------------------------
// 変換ヘルパー
// ---------------------------------------------------------------------------

function toSummary(stored: StoredMap, syncState: SyncState): MindMapSummary {
  return {
    id: stored.id,
    title: stored.title,
    updatedAt: stored.updatedAt,
    createdAt: stored.createdAt,
    nodeCount: stored.nodeCount,
    syncState,
  };
}

function toStoredMap(map: MindMap, nodeCount: number, schemaVersion: number): StoredMap {
  return { ...map, nodeCount, schemaVersion };
}

/** StoredMap から保存用の付加情報を落として MindMap に戻す。 */
function toMindMap(stored: StoredMap): MindMap {
  const { nodeCount: _nodeCount, schemaVersion: _schemaVersion, ...map } = stored;
  return map;
}

function assertReadableSchema(stored: StoredMap): void {
  const version = stored.schemaVersion ?? SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(stored.id, version, SCHEMA_VERSION);
  }
}

/** 保存前の最低限の健全性チェック。壊れたドキュメントを書き込ませない。 */
function assertValidDocument(doc: MindMapDocument): void {
  if (!doc || !doc.map || typeof doc.map.id !== "string" || doc.map.id.length === 0) {
    throw new InvalidDocumentError("map.id のないドキュメントは保存できません。");
  }
  if (!Array.isArray(doc.nodes)) {
    throw new InvalidDocumentError(`マップ ${doc.map.id}: nodes が配列ではありません。`);
  }
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(doc.map.id, doc.schemaVersion, SCHEMA_VERSION);
  }
  const foreign = doc.nodes.find((node) => node.mapId !== doc.map.id);
  if (foreign) {
    throw new InvalidDocumentError(
      `マップ ${doc.map.id} に別マップのノード ${foreign.id}（mapId=${foreign.mapId}）が含まれています。`,
    );
  }
  const ids = new Set<ID>();
  for (const node of doc.nodes) {
    if (ids.has(node.id)) {
      throw new InvalidDocumentError(
        `マップ ${doc.map.id}: ノード ID ${node.id} が重複しています。`,
      );
    }
    ids.add(node.id);
  }
}

// ---------------------------------------------------------------------------
// 低レベル書き込み（トランザクション内）
// ---------------------------------------------------------------------------

type WriteTx = IDBPTransaction<MindMapDb, StoreName[], "readwrite">;

/** 中断する。tx.done の reject が未処理のまま残らないようにしてから投げる。 */
function abortTx(tx: IDBPTransaction<MindMapDb, StoreName[], "readwrite">): void {
  tx.done.catch(() => {
    // abort による reject。呼び出し側がより具体的なエラーを投げる。
  });
  tx.abort();
}

/**
 * maps と nodes を同じトランザクションで書く。片方だけ書かれる状態を作らない。
 *
 * 2つの put は await を挟まずに発行する。IndexedDB のトランザクションは
 * 未処理のリクエストが無くなった時点で自動コミットされるため、
 * 途中で await するとトランザクションが閉じてしまうことがある。
 */
function putDocumentInTx(tx: WriteTx, doc: MindMapDocument): Promise<unknown> {
  return Promise.all([
    tx.objectStore("maps").put(toStoredMap(doc.map, doc.nodes.length, doc.schemaVersion)),
    tx.objectStore("nodes").put({ mapId: doc.map.id, nodes: doc.nodes }),
  ]);
}

async function readDocumentInTx(
  tx: IDBPTransaction<MindMapDb, StoreName[], "readonly" | "readwrite">,
  id: ID,
): Promise<MindMapDocument | null> {
  // 2つの get も await を挟まずに発行する（上と同じ理由）。
  const [stored, nodeRecord] = await Promise.all([
    tx.objectStore("maps").get(id),
    tx.objectStore("nodes").get(id),
  ]);
  if (!stored) return null;
  assertReadableSchema(stored);
  if (!nodeRecord) {
    // maps と nodes は常に同時に書くので、ここに来るのは外部要因の破損のみ。
    // 黙って握りつぶさず記録した上で、ユーザーがマップを開けなくならないようにする。
    console.error(`[db] マップ ${id} のノードレコードが見つかりません。空として読み込みます。`);
  }
  return {
    schemaVersion: stored.schemaVersion ?? SCHEMA_VERSION,
    map: toMindMap(stored),
    nodes: nodeRecord?.nodes ?? [],
  };
}

/** メタ情報だけを変更する共通処理（version と updatedAt を進める）。 */
async function mutateMapMeta(
  db: IDBPDatabase<MindMapDb>,
  id: ID,
  mutate: (map: StoredMap) => StoredMap,
): Promise<void> {
  const tx = db.transaction(["maps"], "readwrite");
  const store = tx.objectStore("maps");
  const stored = await store.get(id);
  if (!stored) {
    abortTx(tx);
    throw new MapNotFoundError(id);
  }
  assertReadableSchema(stored);
  const next = mutate(stored);
  await store.put({ ...next, version: stored.version + 1, updatedAt: now() });
  await tx.done;
}

// ---------------------------------------------------------------------------
// リポジトリ
// ---------------------------------------------------------------------------

export class IndexedDbMapRepository implements MapRepository {
  async listMaps(): Promise<MindMapSummary[]> {
    return this.summaries((stored) => stored.deletedAt === null);
  }

  async searchMaps(query: string): Promise<MindMapSummary[]> {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return this.listMaps();
    return this.summaries(
      (stored) => stored.deletedAt === null && stored.title.toLowerCase().includes(needle),
    );
  }

  async listGuestMaps(): Promise<MindMapSummary[]> {
    return this.summaries((stored) => stored.deletedAt === null && stored.userId === null);
  }

  async getMap(id: ID): Promise<MindMapDocument | null> {
    const db = await openMindMapDb();
    const tx = db.transaction(["maps", "nodes"], "readonly");
    const doc = await readDocumentInTx(tx, id);
    await tx.done;
    if (!doc) return null;
    // 論理削除済みは「無い」ものとして扱う。データ自体は残っている。
    return doc.map.deletedAt === null ? doc : null;
  }

  async saveMap(doc: MindMapDocument): Promise<MindMapDocument> {
    assertValidDocument(doc);
    const db = await openMindMapDb();
    const tx = db.transaction(["maps", "nodes"], "readwrite");
    const existing = await tx.objectStore("maps").get(doc.map.id);

    if (existing) {
      assertReadableSchema(existing);
      if (doc.map.version < existing.version) {
        // 古いデータで新しいデータを潰さない（CLAUDE.md §6）。
        abortTx(tx);
        throw new StaleWriteError(doc.map.id, doc.map.version, existing.version);
      }
    }

    const baseVersion = Math.max(existing?.version ?? 0, doc.map.version);
    const saved: MindMapDocument = {
      schemaVersion: SCHEMA_VERSION,
      map: {
        ...doc.map,
        // createdAt は保存済みの値を正とする（あとから書き換えさせない）。
        createdAt: existing?.createdAt ?? doc.map.createdAt,
        version: baseVersion + 1,
        updatedAt: now(),
      },
      nodes: doc.nodes,
    };

    await putDocumentInTx(tx, saved);
    await tx.done;
    return saved;
  }

  async createMap(title?: string): Promise<MindMapDocument> {
    const doc = createMapDocument(title === undefined ? {} : { title });
    const db = await openMindMapDb();
    const tx = db.transaction(["maps", "nodes"], "readwrite");
    await putDocumentInTx(tx, doc);
    await tx.done;
    return doc;
  }

  async renameMap(id: ID, title: string): Promise<void> {
    const db = await openMindMapDb();
    await mutateMapMeta(db, id, (stored) => ({ ...stored, title }));
  }

  async deleteMap(id: ID): Promise<void> {
    // 論理削除のみ。物理削除の手段はこのモジュールに存在しない。
    const db = await openMindMapDb();
    await mutateMapMeta(db, id, (stored) => ({ ...stored, deletedAt: now() }));
  }

  async restoreMap(id: ID): Promise<void> {
    const db = await openMindMapDb();
    await mutateMapMeta(db, id, (stored) => ({ ...stored, deletedAt: null }));
  }

  async getSyncMeta(mapId: ID): Promise<SyncMeta | null> {
    const db = await openMindMapDb();
    return (await db.get("syncMeta", mapId)) ?? null;
  }

  async setSyncMeta(meta: SyncMeta): Promise<void> {
    const db = await openMindMapDb();
    await db.put("syncMeta", meta);
  }

  async claimGuestMaps(userId: ID): Promise<ID[]> {
    const db = await openMindMapDb();
    const tx = db.transaction(["maps"], "readwrite");
    const store = tx.objectStore("maps");
    const claimed: ID[] = [];

    // userId を書き換えるだけ。削除も作り直しもしない（CLAUDE.md §6）。
    // 論理削除済みのゲストマップも引き継ぐ（取りこぼすと復元できなくなるため）。
    for (const stored of await store.getAll()) {
      if (stored.userId !== null) continue;
      await store.put({ ...stored, userId });
      claimed.push(stored.id);
    }

    await tx.done;
    return claimed;
  }

  /**
   * 一覧系の共通処理。
   * userId / deletedAt は null を取りうり IndexedDB のインデックスに載らないため、
   * インデックス走査ではなく全件取得のうえ JS 側で絞り込む。
   * Phase 1 のマップ件数（〜数百）では十分に速い。
   */
  private async summaries(predicate: (stored: StoredMap) => boolean): Promise<MindMapSummary[]> {
    const db = await openMindMapDb();
    const tx = db.transaction(["maps", "syncMeta"], "readonly");
    const [allMaps, allMeta] = await Promise.all([
      tx.objectStore("maps").getAll(),
      tx.objectStore("syncMeta").getAll(),
    ]);
    await tx.done;

    const stateByMapId = new Map(allMeta.map((meta) => [meta.mapId, meta.state]));
    return (
      allMaps
        .filter(predicate)
        .map((map) => toSummary(map, stateByMapId.get(map.id) ?? "local-only"))
        // 同一ミリ秒で作られたマップでも順序がぶれないよう createdAt と id で決着をつける。
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) ||
            b.createdAt.localeCompare(a.createdAt) ||
            a.id.localeCompare(b.id),
        )
    );
  }
}

// ---------------------------------------------------------------------------
// バックアップ用の低レベルアクセス（src/lib/db/backup.ts から使う）
// ---------------------------------------------------------------------------

/** 論理削除済みも含めた全ドキュメント。バックアップは取りこぼさないことを優先する。 */
export async function readAllDocuments(): Promise<MindMapDocument[]> {
  const db = await openMindMapDb();
  const tx = db.transaction(["maps", "nodes"], "readonly");
  const [maps, nodeRecords] = await Promise.all([
    tx.objectStore("maps").getAll(),
    tx.objectStore("nodes").getAll(),
  ]);
  await tx.done;

  const nodesByMapId = new Map(nodeRecords.map((record) => [record.mapId, record.nodes]));
  return maps.map((stored) => {
    assertReadableSchema(stored);
    return {
      schemaVersion: stored.schemaVersion ?? SCHEMA_VERSION,
      map: toMindMap(stored),
      nodes: nodesByMapId.get(stored.id) ?? [],
    } satisfies MindMapDocument;
  });
}

/**
 * 同じ ID がまだ無いときだけ書き込む。既存データは絶対に上書きしない。
 * 戻り値は実際に書き込んだかどうか。
 */
export async function putDocumentIfAbsent(doc: MindMapDocument): Promise<boolean> {
  assertValidDocument(doc);
  const db = await openMindMapDb();
  const tx = db.transaction(["maps", "nodes"], "readwrite");
  const existing = await tx.objectStore("maps").get(doc.map.id);
  if (existing) {
    await tx.done;
    return false;
  }
  await putDocumentInTx(tx, doc);
  await tx.done;
  return true;
}
