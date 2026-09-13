"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/features/auth/config";

/**
 * ログイン／ログアウト用の Server Action。
 *
 * signIn / signOut は内部で redirect() を投げるため、AuthError 以外の例外は
 * 握りつぶさずそのまま再スローすること（握ると画面遷移が止まる）。
 */

/** Google でログインする。 */
export async function signInWithGoogle(): Promise<void> {
  try {
    await signIn("google", { redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=google");
    throw error;
  }
}

/** 入力されたメールアドレスにマジックリンクを送る。 */
export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) redirect("/login?error=email-required");

  try {
    await signIn("resend", { email, redirectTo: "/" });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=email");
    throw error;
  }
}

/** ログアウトしてトップへ戻る。 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
