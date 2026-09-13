import { getCurrentUser } from "@/features/auth/session";
import { SettingsScreen } from "@/features/settings";

export const metadata = { title: "設定 — Web MindMap" };

/**
 * 設定（/settings）。
 *
 * ここはセッションを読むためだけのサーバコンポーネント。**ログインは必須ではない**
 * （CLAUDE.md §14）。`getCurrentUser()` が null、つまりゲストでも設定はそのまま開ける。
 * redirect() も認証ガードもここには置かないこと。
 *
 * テーマの保存先は localStorage なので、切替 UI の描画はクライアント側で行う。
 */
export default async function SettingsPage() {
  const user = await getCurrentUser();
  return <SettingsScreen user={user} />;
}
