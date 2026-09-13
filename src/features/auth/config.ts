import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import NeonAdapter from "@auth/neon-adapter";
import { createPool } from "@/lib/server/db";

/**
 * Auth.js v5 の設定（サーバ専用）。
 *
 * 設計方針（CLAUDE.md §14 / §30）:
 * - パスワードは自前で持たない。Google OAuth とメールのマジックリンクのみ。
 * - 環境変数が未設定でもアプリは落ちない。未設定のプロバイダは登録をスキップし、
 *   DATABASE_URL が無ければアダプタ自体を外す。ゲスト利用が最優先。
 * - 秘密情報は process.env からのみ読む。
 */

/** 設定済みのプロバイダ ID。ログイン画面はこれを見てボタンの出し分けをする。 */
export type AvailableProvider = "google" | "resend";

function hasEnv(...keys: string[]): boolean {
  return keys.every((key) => Boolean(process.env[key]));
}

/** 環境変数が揃っているプロバイダだけを返す。 */
export function availableProviders(): AvailableProvider[] {
  const providers: AvailableProvider[] = [];
  if (hasEnv("AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET")) providers.push("google");
  if (hasEnv("AUTH_RESEND_KEY", "AUTH_EMAIL_FROM")) providers.push("resend");
  return providers;
}

function buildProviders(): NextAuthConfig["providers"] {
  const providers: NextAuthConfig["providers"] = [];
  const enabled = availableProviders();

  if (enabled.includes("google")) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        // 初回以降も確実にアカウント選択できるようにする。
        authorization: { params: { prompt: "select_account" } },
      }),
    );
  }

  if (enabled.includes("resend")) {
    providers.push(
      Resend({
        apiKey: process.env.AUTH_RESEND_KEY,
        from: process.env.AUTH_EMAIL_FROM,
      }),
    );
  }

  return providers;
}

/**
 * 設定オブジェクトはリクエストごとに組み立てる。
 *
 * NeonAdapter は Pool を要求するが、Cloudflare Workers ではコネクションを
 * リクエストをまたいで共有できない。Pool の生成自体は遅延接続で安価なため、
 * Auth.js 公式の Neon 例と同じくリクエストスコープで作る。
 */
function buildConfig(): NextAuthConfig {
  const useAdapter = Boolean(process.env.DATABASE_URL);

  return {
    adapter: useAdapter ? NeonAdapter(createPool()) : undefined,
    providers: buildProviders(),
    // DB アダプタ利用時の既定は database セッションだが、Cloudflare Workers では
    // セッション参照のたびに Neon への WebSocket 接続が必要になり遅く不安定なため JWT を選ぶ。
    session: { strategy: "jwt" },
    // Cloudflare 上では Vercel 由来のホスト自動判定が効かないため明示的に信頼する。
    trustHost: true,
    pages: { signIn: "/login" },
    callbacks: {
      jwt({ token, user }) {
        // サインイン直後だけ user が入る。以降は token から id を引く。
        // ここで渡るのは users.id の uuid 文字列（001_init.sql）。加工しないこと。
        // 別の値に差し替えると maps.user_id の uuid キャストが落ちる。
        if (user?.id) token.sub = user.id;
        return token;
      },
      session({ session, token }) {
        if (session.user && token.sub) session.user.id = token.sub;
        return session;
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildConfig);
