/**
 * 認証まわりで画面に渡す型だけを置く場所。実装は持たない。
 *
 * サーバ（`session.ts`）とクライアント（`useCurrentUser.ts`）の両方が
 * 同じ形を返す約束なので、型の出どころを 1 つにしておく。ここに実行時の
 * コードを足さないこと — 足すと、この型を読むだけのクライアント側に
 * `next/headers` や Neon がぶら下がってくる。
 */

/** ログイン中のユーザー。ゲストのときはこの型ではなく null を使う。 */
export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};
