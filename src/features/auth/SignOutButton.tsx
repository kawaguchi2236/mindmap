import { signOutAction } from "@/features/auth/actions";

/**
 * ログアウトボタン。設定画面などから使う。
 * スタイルは呼び出し側で className を渡して当てる（担当 A のデザインシステム待ち）。
 */
export function SignOutButton({ className }: { className?: string }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        ログアウト
      </button>
    </form>
  );
}
