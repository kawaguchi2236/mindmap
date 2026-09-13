import { DEFAULT_MAP_TITLE } from "./factory";
import type { MindMapDocument, MindMapNode } from "./types";

/**
 * ルートノードのテキストをマップタイトルの既定値として追従させる。
 *
 * 「ルートに名前を書いたのに一覧では『無題のマップ』のまま」という戸惑いを
 * 無くすためのもの。ただし**ユーザーが一覧で明示的に付けた名前は上書きしない**。
 *
 * 追従する条件は次のどちらか。
 *  - タイトルが既定値（まだ名前を付けていない）
 *  - タイトルが変更前のルートのテキストと一致している（それまで追従していた）
 *
 * 一覧で改名すると、タイトルは既定値でもルートのテキストでもなくなるので
 * 追従が自然に止まる。フラグを持たせないのは、IndexedDB のスキーマを
 * 変えずに済ませるため（CLAUDE.md §6：既存データを触らない）。
 */
export function withRootDerivedTitle(
  previous: MindMapDocument | null,
  next: MindMapDocument,
): MindMapDocument {
  const nextRootText = findRoot(next.nodes)?.text.trim() ?? "";
  // ルートを空にしたときにタイトルを消さない（意図せず名前を失わせない）。
  if (nextRootText === "") return next;

  const currentTitle = next.map.title;
  if (currentTitle === nextRootText) return next;

  const previousRootText = findRoot(previous?.nodes ?? [])?.text.trim() ?? "";
  const isFollowing = currentTitle === DEFAULT_MAP_TITLE || currentTitle === previousRootText;
  if (!isFollowing) return next;

  return { ...next, map: { ...next.map, title: nextRootText } };
}

function findRoot(nodes: MindMapNode[]): MindMapNode | undefined {
  return nodes.find((node) => node.parentId === null);
}
