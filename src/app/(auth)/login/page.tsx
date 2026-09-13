import Link from "next/link";
import { availableProviders } from "@/features/auth/config";
import { signInWithEmail, signInWithGoogle } from "@/features/auth/actions";

export const metadata = { title: "ログイン — Web MindMap" };

/**
 * エラーメッセージ。
 *
 * 小文字のキーは actions.ts が付けるもの。CamelCase のキーは Auth.js 自身が
 * `pages.signIn` へリダイレクトするときに付ける標準コード。
 * 未知のコードは汎用文言にフォールバックする。
 */
const ERROR_MESSAGES: Record<string, string> = {
  google: "Google ログインに失敗しました。時間をおいて再度お試しください。",
  email: "ログインリンクを送信できませんでした。メールアドレスをご確認ください。",
  "email-required": "メールアドレスを入力してください。",
  // 同じメールアドレスが別のログイン方法で既に登録されている場合。
  OAuthAccountNotLinked:
    "このメールアドレスは別のログイン方法で登録済みです。前回と同じ方法でログインしてください。",
  EmailSignin: "ログインリンクを送信できませんでした。メールアドレスをご確認ください。",
  Verification: "このログインリンクは期限切れか、すでに使用済みです。もう一度お試しください。",
  AccessDenied: "ログインが許可されませんでした。",
  Configuration: "ログイン設定に問題があります。しばらくしてからお試しください。",
};

/**
 * ログイン画面。
 *
 * ログインは必須ではない（CLAUDE.md §14）。ログインせずに使う導線を必ず残す。
 * 見た目は担当 A のデザインシステム待ちのため、最小限のスタイルにとどめる。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const providers = availableProviders();
  const message = error ? (ERROR_MESSAGES[error] ?? "ログインに失敗しました。") : null;

  return (
    <main style={{ maxWidth: 360, margin: "0 auto", padding: "64px 16px" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>ログイン</h1>
      <p style={{ fontSize: 13, lineHeight: 1.7, marginBottom: 24 }}>
        ログインすると、作成したマップが複数の端末で同期されます。
      </p>

      {message && (
        <p role="alert" style={{ fontSize: 13, marginBottom: 16 }}>
          {message}
        </p>
      )}

      {providers.length === 0 && (
        <p style={{ fontSize: 13, marginBottom: 16 }}>
          現在ログインはご利用いただけません。ログインせずにそのままお使いください。
        </p>
      )}

      {providers.includes("google") && (
        <form action={signInWithGoogle} style={{ marginBottom: 24 }}>
          <button type="submit" style={{ width: "100%", padding: "10px 12px" }}>
            Google でログイン
          </button>
        </form>
      )}

      {providers.includes("resend") && (
        <form action={signInWithEmail} style={{ marginBottom: 24 }}>
          <label htmlFor="email" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
            メールアドレス
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            style={{ width: "100%", padding: "10px 12px", marginBottom: 8 }}
          />
          <button type="submit" style={{ width: "100%", padding: "10px 12px" }}>
            ログインリンクを送る
          </button>
        </form>
      )}

      <Link href="/" style={{ fontSize: 13 }}>
        ログインせずに使う
      </Link>
    </main>
  );
}
