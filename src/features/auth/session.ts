/**
 * 認証セッションの参照口（サーバ専用）。
 *
 * API ルートや Server Component はここだけを見る。Auth.js の実装詳細に
 * 直接依存しないため、認証方式を差し替えてもルート側を書き換えずに済む。
 *
 * 未ログインでもアプリは使える（CLAUDE.md §14）。null は異常ではなくゲスト。
 */
import { cookies } from "next/headers";
import type { Session } from "next-auth";
import { auth } from "@/features/auth/config";
import type { SessionUser } from "@/features/auth/types";

/*
 * 型の定義は `types.ts` に置いてある。クライアント側の `useCurrentUser()` が
 * 同じ形を返すためで、そちらからこのファイル（`next/headers` と Neon を
 * 引き込むサーバ専用モジュール）を import させないための分離。
 * 既存の import 元を変えずに済むよう、ここからも再輸出しておく。
 */
export type { SessionUser };

/** ログイン中なら SessionUser、ゲストなら null を返す。 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  /*
   * AUTH_SECRET が無ければセッションは存在しえない。それでも auth() を呼ぶと
   * Auth.js がリクエストのたびに MissingSecret を吐き、本当のエラーが
   * ログに埋もれる（実機で確認済み）。ゲスト利用は例外処理ではなく
   * この早期 return で成立させる。
   */
  if (!process.env.AUTH_SECRET) {
    /*
     * ただし cookies() には触れておく。これを省くと、この関数を呼ぶページが
     * 「リクエストに依存しない」と判定されて静的プリレンダリングされる。
     * ビルド環境にだけ AUTH_SECRET が無いと、ログイン中のユーザーにも
     * 「ゲスト」が焼き込まれたページが配信されてしまう。
     * セッションを見て出し分ける画面は、secret の有無にかかわらず動的であるべき。
     */
    await cookies();
    return null;
  }

  let session: Session | null = null;
  try {
    session = await auth();
  } catch (error) {
    // AUTH_SECRET 未設定など認証基盤が使えない状態でも、ゲストとして
    // アプリを使い続けられることを優先する（CLAUDE.md §29）。
    console.error("[auth] セッションの取得に失敗しました", error);
    return null;
  }

  const user = session?.user;
  if (!user?.id || !user.email) return null;

  return { id: user.id, email: user.email, name: user.name ?? null };
}
