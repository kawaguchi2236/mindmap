"use client";

/**
 * クライアントコンポーネントからログイン中のユーザーを見る口。
 *
 * サーバ側の `getCurrentUser()`（`session.ts`）と**同じ形**を返す。
 * どちらも「ログイン中なら SessionUser、それ以外は null」で、
 * null は異常ではなくゲスト（CLAUDE.md §14）。
 *
 * 守る約束:
 *   - **ゲストで壊れない。** `<AuthSessionProvider>` が無くても、
 *     セッションの取得に失敗しても、例外を投げずに null を返す。
 *   - **ログインを要求しない。** リダイレクトもガードもしない。
 */

import { useContext, useMemo } from "react";
import { SessionContext } from "next-auth/react";
import type { SessionUser } from "@/features/auth/types";

export interface CurrentUser {
  /** ログイン中なら本人、ゲスト（または判定前）は null。 */
  user: SessionUser | null;
  /** セッションの問い合わせが進行中。true のあいだ user は null。 */
  loading: boolean;
}

const GUEST: CurrentUser = { user: null, loading: false };

export function useCurrentUser(): CurrentUser {
  /*
   * `useSession()` ではなく Context を直に読む。
   *
   * `useSession()` は `<SessionProvider>` の外で呼ばれると開発時に例外を投げる。
   * この口は同期の配線やエディタなど「ログインしていなくても動く画面」から
   * 呼ばれるので、Provider の置き忘れでアプリが落ちるのは割に合わない。
   * 置かれていなければ全員ゲスト、で十分（CLAUDE.md §29）。
   */
  const session = useContext(SessionContext);

  /*
   * 呼び出し側が useEffect の依存に入れても再実行が続かないよう、同じ入力には
   * 同じオブジェクトを返す。Context の値自体は next-auth 側で memo 済み。
   */
  return useMemo<CurrentUser>(() => {
    // Provider が無い。ゲストとして扱う（取得中ではないので loading は false）。
    if (session === undefined) return GUEST;
    if (session.status === "loading") return { user: null, loading: true };

    /*
     * 取得に失敗した場合も next-auth は data: null で返してくる
     * （AUTH_SECRET 未設定などで `/api/auth/session` が 500 を返すケース）。
     * つまりここはゲストと同じ経路に落ちる。**アプリは止めない。**
     */
    const user = session.data?.user;
    // サーバ側と同じ判定。id か email が欠けたセッションは本人と見なさない。
    if (!user?.id || !user.email) return GUEST;

    return { user: { id: user.id, email: user.email, name: user.name ?? null }, loading: false };
  }, [session]);
}
