import { render as baseRender, screen, waitFor } from "@testing-library/react";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme";
import { MapListScreen } from "@/features/maps";
import { SettingsScreen } from "@/features/settings";
import { TemplateScreen } from "@/features/templates";

/**
 * 広告の設置位置の検証（CLAUDE.md §15）。
 *
 * §15 は「どこに出すか」より **「どこに出さないか」** が厳しい。ここでは
 * 出してよい3画面（マップ一覧・設定・テンプレート）に出ていることと、
 * エディタ側に入り込んでいないことの両方を固定する。
 *
 * jsdom での検証なので、見た目（帯の高さ・キャンバスの作業領域を削っていないこと）は
 * ここでは確認できていない。実ブラウザで確認すること。
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/** ログアウトは Server Action。jsdom では next-auth の設定を読ませたくないので差し替える。 */
vi.mock("@/features/auth/actions", () => ({
  signOutAction: vi.fn(),
}));

beforeEach(() => {
  // 事業者 ID を入れた状態、つまり「広告が出る」条件で位置を確かめる。
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", "ca-pub-test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function render(ui: ReactElement) {
  return baseRender(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("マップ一覧の広告", () => {
  it("一覧より後ろに1つだけ置き、行の間には挟まない", async () => {
    const { container } = render(<MapListScreen signedIn={false} />);

    await waitFor(() => expect(screen.getByText(/まだマップがありません/)).toBeInTheDocument());

    const slots = container.querySelectorAll("[data-ad-slot]");
    expect(slots).toHaveLength(1);

    const slot = slots[0];
    // 一覧（ul / li）の中に入れないこと。検索とスクロールの邪魔になる。
    expect(slot.closest("ul")).toBeNull();
    expect(slot.closest("li")).toBeNull();
    expect(slot).toHaveAttribute("data-ad-slot", "map-list");
  });

  it("ログイン中でも同じ位置に出る（Phase 1 は全員 Free）", async () => {
    const { container } = render(<MapListScreen signedIn={true} />);

    await waitFor(() => expect(screen.getByText(/まだマップがありません/)).toBeInTheDocument());

    expect(container.querySelectorAll('[data-ad-slot="map-list"]')).toHaveLength(1);
  });

  it("マップを開くリンクを広告が横取りしない", async () => {
    const { container } = render(<MapListScreen signedIn={false} />);

    await waitFor(() => expect(screen.getByText(/まだマップがありません/)).toBeInTheDocument());

    const slot = container.querySelector("[data-ad-slot]") as HTMLElement;
    // 枠の中にリンクも入力も無い＝クリック先を奪わない。
    expect(slot.querySelector("a")).toBeNull();
    expect(slot.querySelector("button")).toBeNull();
  });
});

describe("設定画面の広告", () => {
  it("設定の項目をすべて出したあとに1つだけ置く", () => {
    const { container } = render(<SettingsScreen user={null} />);

    const slots = container.querySelectorAll("[data-ad-slot]");
    expect(slots).toHaveLength(1);
    expect(slots[0]).toHaveAttribute("data-ad-slot", "settings");

    // 「アカウント」の区分より後ろにあること（設定項目の間に割り込まない）。
    const account = screen.getByRole("heading", { name: "アカウント" });
    expect(account.compareDocumentPosition(slots[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("ログイン中でも出る（Phase 1 は全員 Free）", () => {
    const { container } = render(
      <SettingsScreen user={{ id: "u1", email: "a@example.com", name: "テスト" }} />,
    );

    expect(container.querySelectorAll('[data-ad-slot="settings"]')).toHaveLength(1);
  });
});

describe("テンプレート画面の広告", () => {
  it("一覧をすべて出したあとに1つだけ置く", () => {
    const { container } = render(<TemplateScreen signedIn={false} />);

    const slots = container.querySelectorAll("[data-ad-slot]");
    expect(slots).toHaveLength(1);
    expect(slots[0]).toHaveAttribute("data-ad-slot", "templates");

    // テンプレートのグリッド（ul / li）の中に割り込ませない。
    expect(slots[0].closest("ul")).toBeNull();
    expect(slots[0].closest("li")).toBeNull();
  });

  it("テンプレートを選ぶ操作を広告が横取りしない", () => {
    const { container } = render(<TemplateScreen signedIn={false} />);

    const slot = container.querySelector("[data-ad-slot]") as HTMLElement;
    expect(slot.querySelector("a")).toBeNull();
    expect(slot.querySelector("button")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// エディタに広告が混ざっていないこと
// ---------------------------------------------------------------------------

/**
 * エディタは触っていない、で済ませずにソースで固定する。
 *
 * §15 の禁止事項のうち「エディタのキャンバス」「マップを開く前」は、
 * 他の担当が後から広告を持ち込んでも気づけるようにしておきたい。
 * 描画結果ではなく import を見るのは、キャンバスの描画に依存せず確実に落とせるため。
 */
const ROOT = path.resolve(__dirname, "../..");

async function sourceFiles(target: string): Promise<string[]> {
  const full = path.join(ROOT, target);
  const entries = await readdir(full, { withFileTypes: true, recursive: true }).catch(() => null);
  if (entries === null) return [full];
  return entries
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

describe("エディタには広告を置かない", () => {
  it("エディタ側のソースが広告機能を読み込んでいない", async () => {
    const targets = [
      ...(await sourceFiles("src/features/editor")),
      ...(await sourceFiles("src/app/page.tsx")),
    ];
    expect(targets.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of targets) {
      const source = await readFile(file, "utf8");
      if (/features\/ads|AdSlot|shouldShowAds/.test(source)) {
        offenders.push(path.relative(ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
