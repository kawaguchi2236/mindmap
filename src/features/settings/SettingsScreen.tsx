"use client";

/**
 * 設定画面（task.md §15）。
 *
 * 項目は「テーマ」「アカウント」「ログアウト」の3つだけ。ここを何でも置ける
 * 物置にしないこと（CLAUDE.md §37）。
 *
 * ゲストのまま開ける。ログインは案内するだけで、この画面にリダイレクトや
 * ガードは入れない（CLAUDE.md §14）。
 *
 * 見た目は担当 A のデザインシステム（src/components/**）に乗せる。
 * 色・余白・影は必ずトークン変数を使い、ダークモードの分岐は書かない
 * （3状態ぶんのトークンが定義済みなので var() を使えば自動で追従する）。
 */

import Link from "next/link";
import { useState } from "react";
import { AppHeader, AppShell, Sidebar } from "@/components/layout";
import { ThemeToggle, useTheme } from "@/components/theme";
import { AdSlot } from "@/features/ads";
import { SignOutButton } from "@/features/auth/SignOutButton";
import type { SessionUser } from "@/features/auth/session";
import { SyncRunner } from "@/features/sync";
import styles from "./SettingsScreen.module.css";

export interface SettingsScreenProps {
  /**
   * ログイン中のユーザー。ゲストは null。
   * null は異常ではなく通常の状態なので、ここで遷移を起こさないこと。
   */
  user: SessionUser | null;
}

export function SettingsScreen({ user }: SettingsScreenProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <AppShell
      header={
        // テーマ切替は本文の「表示」に置くので、ヘッダーからは外す。
        // 同じ画面に同じラジオグループが2つ並ぶと、どちらが設定なのか分からなくなる。
        <AppHeader
          title="Web MindMap"
          hideThemeToggle
          onMenuClick={() => setSidebarOpen((open) => !open)}
          menuExpanded={sidebarOpen}
        />
      }
      sidebar={
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          heading="Menu"
          label="メインナビゲーション"
        >
          <nav className={styles.nav} aria-label="画面">
            <Link className={styles.navLink} href="/maps">
              マップ一覧
            </Link>
            <Link className={styles.navLink} href="/">
              エディタを開く
            </Link>
            <Link className={styles.navLink} href="/templates">
              テンプレート
            </Link>
            <Link className={styles.navLink} href="/settings" aria-current="page">
              設定
            </Link>
          </nav>
        </Sidebar>
      }
    >
      <div className={styles.head}>
        <h1 className={styles.title}>設定</h1>
      </div>

      <ThemeSection />
      <AccountSection user={user} />

      {/* 広告帯（無料プランのみ）。設定の項目をすべて出し切ったあとに置く。
          エディタには出さない（CLAUDE.md §15）。 */}
      <AdSlot slot="settings" signedIn={user !== null} />
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 表示（テーマ）
// ---------------------------------------------------------------------------

/**
 * テーマの3択。
 *
 * ラジオグループ本体は共有の `ThemeToggle`（ライト／ダーク／システムの3択）を
 * そのまま使う。状態管理を自前で持たないこと — 保存先は localStorage で、
 * ヘッダー・別タブ・描画前のインラインスクリプトと同じ値を見る必要がある。
 *
 * ここが足すのは「いまどちらの配色で表示されているか」の補足だけ。
 * 「システム」を選んでいると、選択ラベルだけでは実際の見え方が分からないため。
 */
function ThemeSection() {
  const { theme, resolvedTheme, mounted } = useTheme();

  // マウント前は保存値も OS の設定も分からない。確定するまで補足は出さない。
  const applied =
    mounted && theme === "system" ? (resolvedTheme === "dark" ? "ダーク" : "ライト") : null;

  return (
    <section className={styles.section} aria-labelledby="settings-appearance">
      <h2 id="settings-appearance" className={styles.sectionTitle}>
        表示
      </h2>

      <div className={styles.row}>
        <div className={styles.rowText}>
          <span className={styles.rowLabel}>テーマ</span>
          <p className={styles.rowHint}>
            「システム」は OS のライト／ダークの設定に合わせます。
            {applied !== null && `いまは${applied}で表示しています。`}
          </p>
        </div>
        <ThemeToggle className={styles.rowControl} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// アカウント
// ---------------------------------------------------------------------------

function AccountSection({ user }: { user: SessionUser | null }) {
  return (
    <section className={styles.section} aria-labelledby="settings-account">
      <h2 id="settings-account" className={styles.sectionTitle}>
        アカウント
      </h2>

      {user === null ? (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>ゲストとして利用中</span>
            <p className={styles.rowHint}>
              マップはこの端末に保存されています。ログインすると複数の端末で同期されます。
              ログインしなくても、これまでどおりすべての機能を使えます。
            </p>
          </div>
          {/* 案内だけ。ここから先へ進むかはユーザーが決める（CLAUDE.md §14）。 */}
          <Link className={styles.linkAction} href="/login">
            ログイン
          </Link>
        </div>
      ) : (
        <div className={styles.row}>
          <div className={styles.rowText}>
            <span className={styles.rowLabel}>{user.name ?? user.email}</span>
            {user.name !== null && <p className={styles.rowMeta}>{user.email}</p>}
            <p className={styles.rowHint}>
              マップはこの端末に保存したうえで、クラウドにも同期されます。
            </p>
            {/* この画面を開いているあいだ、背景でクラウド同期を回す。
                オフラインでも設定操作は妨げない（CLAUDE.md §12）。 */}
            <SyncRunner userId={user.id} />
          </div>
          {/* ログアウトは認証側の実装をそのまま使う（Server Action）。 */}
          <SignOutButton className={styles.signOut} />
        </div>
      )}
    </section>
  );
}
