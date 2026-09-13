import {
  SCHEMA_VERSION,
  type ID,
  type ISODateString,
  type MindMap,
  type MindMapDocument,
  type MindMapNode,
} from "./types";

/**
 * 新規マップの既定タイトル。
 * 「まだ明示的に名前を付けていない」ことの目印として使うので、
 * 表示用に書き換えるときは `src/lib/model/title.ts` も合わせて見ること。
 */
export const DEFAULT_MAP_TITLE = "無題のマップ";

export function newId(): ID {
  return crypto.randomUUID();
}

export function now(): ISODateString {
  return new Date().toISOString();
}

export function createNode(
  params: Pick<MindMapNode, "mapId" | "parentId"> &
    Partial<Omit<MindMapNode, "mapId" | "parentId">>,
): MindMapNode {
  const timestamp = params.updatedAt ?? now();
  return {
    id: params.id ?? newId(),
    mapId: params.mapId,
    parentId: params.parentId,
    text: params.text ?? "",
    x: params.x ?? 0,
    y: params.y ?? 0,
    collapsed: params.collapsed ?? false,
    order: params.order ?? 0,
    createdAt: params.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

export function createMap(params: Partial<MindMap> = {}): MindMap {
  const timestamp = params.updatedAt ?? now();
  return {
    id: params.id ?? newId(),
    userId: params.userId ?? null,
    title: params.title ?? DEFAULT_MAP_TITLE,
    createdAt: params.createdAt ?? timestamp,
    updatedAt: timestamp,
    deletedAt: params.deletedAt ?? null,
    version: params.version ?? 1,
  };
}

/** ルートノード1つだけを持つ、新規マップのドキュメントを作る。 */
export function createMapDocument(params: Partial<MindMap> = {}, rootText = ""): MindMapDocument {
  const map = createMap(params);
  const root = createNode({ mapId: map.id, parentId: null, text: rootText });
  return { schemaVersion: SCHEMA_VERSION, map, nodes: [root] };
}
