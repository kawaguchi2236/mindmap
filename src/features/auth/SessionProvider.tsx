"use client";

/**
 * クライアント側でセッションを配るための入れ物。
 *
 * なぜ必要か: サーバ側の `getCurrentUser()` をルートレイアウトで呼ぶと、
 * `cookies()` に触れる以上アプリ全体が動的レンダリングに落ちる。エディタ（`/`）は
 * 静的プリレンダリングのまま保ちたい（いちばん呼ばれる経路で Workers の
 * CPU を使わない、ADR-001）。これはクライアントコンポーネントなので、
 * レイアウトに置いてもプリレンダリングされた HTML に含まれるだけで、
 * 静的のままでいられる。
 *
 * 使い方（`src/app/layout.tsx`）:
 *
 *     <AuthSessionProvider>{children}</AuthSessionProvider>
 *
 * 中身を読むのは `useCurrentUser()`。これを置かなくてもアプリは壊れず、
 * 全員がゲスト扱いになるだけ（CLAUDE.md §14）。
 */

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    /*
     * タブを切り替えるたびの再取得は止める。
     *
     * 既定は true で、フォーカスが戻るたびに `/api/auth/session` を叩く。
     * エディタは行き来しながら使うものなので、これは Workers の呼び出しを
     * 体感の変わらないところで増やすだけになる（CLAUDE.md §10 / ADR-001）。
     * セッションは JWT で寿命が長く、同じブラウザでのログイン・ログアウトは
     * next-auth が BroadcastChannel 越しに拾うので、この設定でも取りこぼさない。
     */
    <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>
  );
}
