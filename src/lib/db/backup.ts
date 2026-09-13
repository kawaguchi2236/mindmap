/**
 * ローカルデータの書き出し・取り込み（CLAUDE.md §6 データ安全）。
 *
 * 取り込みは「既にある ID は触らない」だけの安全側に倒した実装にしてある。
 * マージや上書きは、ユーザーの意図を確認せずに行うとデータを失うため扱わない。
 */

import { SCHEMA_VERSION, type MindMapDocument } from "@/lib/model/types";
import { putDocumentIfAbsent, readAllDocuments } from "./indexeddb";
import { InvalidDocumentError, UnsupportedSchemaVersionError } from "./errors";

/** 論理削除済みも含めた全マップを JSON 文字列（MindMapDocument[]）で書き出す。 */
export async function exportAllMaps(): Promise<string> {
  const docs = await readAllDocuments();
  return JSON.stringify(docs, null, 2);
}

export interface ImportResult {
  imported: number;
  /** 同じ ID が既にあったため触らなかった件数。 */
  skipped: number;
}

/**
 * 書き出した JSON を取り込む。
 * 同じ ID が既に存在する場合は**上書きせずスキップ**する。
 */
export async function importMaps(json: string): Promise<ImportResult> {
  const docs = parseDocuments(json);
  let imported = 0;
  let skipped = 0;

  for (const doc of docs) {
    if (await putDocumentIfAbsent(doc)) {
      imported += 1;
    } else {
      skipped += 1;
    }
  }

  return { imported, skipped };
}

function parseDocuments(json: string): MindMapDocument[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new InvalidDocumentError(
      `取り込むデータが JSON として読めません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new InvalidDocumentError("取り込むデータは MindMapDocument の配列である必要があります。");
  }

  return parsed.map((value, index) => toDocument(value, index));
}

function toDocument(value: unknown, index: number): MindMapDocument {
  if (typeof value !== "object" || value === null) {
    throw new InvalidDocumentError(`${index} 件目がオブジェクトではありません。`);
  }
  const candidate = value as Partial<MindMapDocument>;
  const map = candidate.map;
  if (!map || typeof map.id !== "string" || typeof map.title !== "string") {
    throw new InvalidDocumentError(`${index} 件目に有効な map がありません。`);
  }
  if (!Array.isArray(candidate.nodes)) {
    throw new InvalidDocumentError(`マップ ${map.id} に nodes 配列がありません。`);
  }
  const schemaVersion = candidate.schemaVersion ?? SCHEMA_VERSION;
  if (schemaVersion > SCHEMA_VERSION) {
    // 新しい版のデータを古いアプリで読み込むと情報を落とす。取り込まない。
    throw new UnsupportedSchemaVersionError(map.id, schemaVersion, SCHEMA_VERSION);
  }
  return { schemaVersion, map, nodes: candidate.nodes } as MindMapDocument;
}
