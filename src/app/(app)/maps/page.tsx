import { getCurrentUser } from "@/features/auth/session";
import { MapListScreen } from "@/features/maps";

export const metadata = { title: "マップ — Web MindMap" };

/**
 * マップ一覧（/maps）。
 *
 * ここはセッションを読むためだけのサーバコンポーネント。**ログインは必須ではない**
 * （CLAUDE.md §14）。`getCurrentUser()` が null、つまりゲストでも一覧はそのまま使える。
 * ログイン中は追加で同期状態を出すだけ。
 *
 * 一覧の中身はローカルの IndexedDB から読むため、描画はクライアント側で行う
 * （サーバコンポーネントから `src/lib/db` を呼ばないこと）。
 */
export default async function MapsPage() {
  const user = await getCurrentUser();
  return <MapListScreen signedIn={user !== null} />;
}
