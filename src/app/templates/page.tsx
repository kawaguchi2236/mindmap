import { getCurrentUser } from "@/features/auth/session";
import { TemplateScreen } from "@/features/templates";

export const metadata = { title: "テンプレート — Web MindMap" };

/**
 * テンプレート（/templates）。
 *
 * ここはセッションを読むためだけのサーバコンポーネント。**ログインは必須ではない**
 * （CLAUDE.md §14）。ゲストでもテンプレートからマップを作れる。
 * マップの作成先はローカルの IndexedDB なので、中身の描画はクライアント側で行う。
 */
export default async function TemplatesPage() {
  const user = await getCurrentUser();
  return <TemplateScreen signedIn={user !== null} />;
}
