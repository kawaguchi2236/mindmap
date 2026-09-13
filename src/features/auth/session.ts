/**
 * 認証セッションの参照口（サーバ専用）。
 *
 * API ルートや Server Component はここだけを見る。Auth.js の実装詳細に
 * 直接依存しないため、認証方式を差し替えてもルート側を書き換えずに済む。
 *
 * 未ログインでもアプリは使える（CLAUDE.md §14）。null は異常ではなくゲスト。
 */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

/** ログイン中なら SessionUser、ゲストなら null を返す。 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  // 実装は担当 B1（Auth.js 設定）で差し替える。
  return null;
}
