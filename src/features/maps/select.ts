/**
 * 一覧の絞り込みと並び替え。すべて純粋関数。
 *
 * 検索はリポジトリの `searchMaps()` ではなくクライアント側で行う。
 * Phase 1 の想定件数は数十件で、入力のたびに IndexedDB を叩くより
 * 手元の配列を絞るほうが速く、キー入力を止めない（CLAUDE.md §40-2）。
 */

import type { MindMapSummary } from "@/lib/model/types";

/**
 * 検索語とタイトルの正規化。
 *
 * NFKC をかけるのは、全角で打った「ＡＢＣ」や半角カナが
 * 素の `includes` では一致しないため。日本語入力では実際によく起きる。
 */
export function normalizeForSearch(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

/** タイトルの部分一致で絞り込む。空文字・空白のみのときは全件返す。 */
export function filterMapsByTitle(maps: MindMapSummary[], query: string): MindMapSummary[] {
  const needle = normalizeForSearch(query);
  if (needle.length === 0) return maps;
  return maps.filter((map) => normalizeForSearch(map.title).includes(needle));
}

/**
 * 更新日時の新しい順。同時刻なら作成日時の新しい順、それも同じなら id 順。
 * 並びが毎回変わると「さっき見た行」を見失うので、必ず全順序を決める。
 */
export function sortMapsByUpdatedAt(maps: MindMapSummary[]): MindMapSummary[] {
  return [...maps].sort((a, b) => {
    const byUpdated = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    const byCreated = Date.parse(b.createdAt) - Date.parse(a.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

/**
 * 一覧に実際に描画する行を決める。
 *
 * 論理削除済みをここでも落としているのは二重の保険。リポジトリの
 * `listMaps()` は既に除外しているが、削除直後の取り消し待ちなど
 * 手元の配列に墓標が混ざる経路を増やしても画面が壊れないようにしておく。
 */
export function visibleMaps(maps: MindMapSummary[], query: string): MindMapSummary[] {
  const alive = maps.filter((map) => map.deletedAt === null);
  return sortMapsByUpdatedAt(filterMapsByTitle(alive, query));
}
