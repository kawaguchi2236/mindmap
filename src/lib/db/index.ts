/**
 * ローカル永続化の入口。利用側は必ずここから `getRepository()` を使う。
 *
 * ```ts
 * import { getRepository } from "@/lib/db";
 * const maps = await getRepository().listMaps();
 * ```
 *
 * 注意: Next.js の SSR でこのモジュールが import されても落ちないよう、
 * `getRepository()` 自体は IndexedDB に触らない。実際にメソッドを呼んだ時点で
 * `IndexedDbUnavailableError` になる。
 */

import { IndexedDbMapRepository } from "./indexeddb";
import type { MapRepository } from "./types";

let repository: MapRepository | null = null;

export function getRepository(): MapRepository {
  if (!repository) {
    repository = new IndexedDbMapRepository();
  }
  return repository;
}

/** テスト用: シングルトンと DB 接続を捨てる。 */
export async function resetRepositoryForTests(): Promise<void> {
  const { closeMindMapDb } = await import("./indexeddb");
  repository = null;
  await closeMindMapDb();
}

export type { MapRepository } from "./types";
export {
  IndexedDbUnavailableError,
  InvalidDocumentError,
  LocalStoreError,
  MapNotFoundError,
  StaleWriteError,
  UnsupportedSchemaVersionError,
} from "./errors";
