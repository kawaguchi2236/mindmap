import { act, render as baseRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/components/theme";
import { SettingsScreen } from "@/features/settings";

/**
 * 設定画面の操作テスト（jsdom）。
 *
 * jsdom は実ブラウザではないため、レイアウト・CSS Module の見え方・
 * フォーカスリングの実描画・OS のダークモード設定への実追従はここでは
 * 検証できていない。確認できるのは DOM と属性・保存値まで。
 */

/**
 * ログアウトは Server Action。jsdom では next-auth の設定を読み込ませたくないので、
 * アクションだけ差し替える。SignOutButton 自体は本物をそのまま描画する。
 */
const signOutAction = vi.fn();
vi.mock("@/features/auth/actions", () => ({
  signOutAction: (...args: unknown[]) => signOutAction(...args),
}));

/**
 * jsdom は matchMedia を持たない。ThemeProvider が OS のダークモード設定を
 * 購読するのに使うので、切り替えられるスタブを置く。
 * （共有の tests/setup.ts は担当 A の所有なので、ここで閉じて用意する）
 */
function stubMatchMedia(systemDark: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: systemDark && query.includes("dark"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * ThemeProvider は「このタブでの最後の選択」をモジュール変数にも持っている
 * （localStorage に書けない環境でもそのタブの間はテーマが効くようにするため）。
 * テストは同じモジュールを共有するので、localStorage を消すだけでは前のテストの
 * 選択が次に漏れる。別タブでの変更と同じ storage イベントを投げて捨てさせる。
 */
function resetThemeState() {
  window.localStorage.clear();
  const probe = baseRender(
    <ThemeProvider>
      <span />
    </ThemeProvider>,
  );
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
  });
  probe.unmount();
  document.documentElement.removeAttribute("data-theme");
}

beforeEach(() => {
  signOutAction.mockClear();
  stubMatchMedia(false);
  resetThemeState();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 本番では RootLayout が ThemeProvider を張っている。テストでも同じ形で包む。 */
function render(ui: ReactElement) {
  return baseRender(<ThemeProvider>{ui}</ThemeProvider>);
}

const signedInUser = { id: "u1", email: "hana@example.com", name: null };

describe("SettingsScreen（ゲスト）", () => {
  it("ログインしていなくても設定画面がそのまま開ける", () => {
    render(<SettingsScreen user={null} />);

    expect(screen.getByRole("heading", { name: "設定", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("ゲストとして利用中")).toBeInTheDocument();
    // テーマの3択もゲストのまま使える。
    expect(screen.getByRole("group", { name: "テーマ" })).toBeInTheDocument();
  });

  it("ログインを促すが強制はしない", () => {
    render(<SettingsScreen user={null} />);

    const link = screen.getByRole("link", { name: "ログイン" });
    expect(link).toHaveAttribute("href", "/login");
    expect(screen.getByText(/複数の端末で同期されます/)).toBeInTheDocument();
    // 「ログインしないと使えない」ようには見せない。
    expect(screen.getByText(/これまでどおりすべての機能を使えます/)).toBeInTheDocument();
  });

  it("ゲストにはログアウトを出さない", () => {
    render(<SettingsScreen user={null} />);

    expect(screen.queryByRole("button", { name: "ログアウト" })).not.toBeInTheDocument();
  });
});

describe("SettingsScreen（ログイン中）", () => {
  it("メールアドレスを表示する", () => {
    render(<SettingsScreen user={signedInUser} />);

    expect(screen.getByText("hana@example.com")).toBeInTheDocument();
    expect(screen.queryByText("ゲストとして利用中")).not.toBeInTheDocument();
  });

  it("名前があれば名前とメールアドレスの両方を出す", () => {
    render(<SettingsScreen user={{ ...signedInUser, name: "花子" }} />);

    expect(screen.getByText("花子")).toBeInTheDocument();
    expect(screen.getByText("hana@example.com")).toBeInTheDocument();
  });

  it("ログアウトボタンを出し、ログイン導線は出さない", () => {
    render(<SettingsScreen user={signedInUser} />);

    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ログイン" })).not.toBeInTheDocument();
  });

  it("押すと認証側の Server Action が呼ばれる", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen user={signedInUser} />);

    await user.click(screen.getByRole("button", { name: "ログアウト" }));

    // 自前で signOut を呼ぶのではなく、既存の signOutAction に委ねていること。
    expect(signOutAction).toHaveBeenCalledTimes(1);
  });
});

describe("SettingsScreen のテーマ切替", () => {
  it("3状態を明示的に選べる", () => {
    render(<SettingsScreen user={null} />);

    const group = screen.getByRole("group", { name: "テーマ" });
    expect(group).toBeInTheDocument();
    for (const label of ["ライト", "ダーク", "システム"]) {
      expect(screen.getByRole("radio", { name: label })).toBeInTheDocument();
    }
    // 既定は OS 追従。
    expect(screen.getByRole("radio", { name: "システム" })).toBeChecked();
  });

  it("ダークを選ぶと data-theme が付き、選択が保存される", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen user={null} />);

    await user.click(screen.getByRole("radio", { name: "ダーク" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("明示ライトを選ぶと、OS がダークでもライトのままになる", async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    render(<SettingsScreen user={null} />);

    await user.click(screen.getByRole("radio", { name: "ライト" }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("システムに戻すと data-theme を外して OS の設定に委ねる", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen user={null} />);

    await user.click(screen.getByRole("radio", { name: "ダーク" }));
    await user.click(screen.getByRole("radio", { name: "システム" }));

    expect(document.documentElement).not.toHaveAttribute("data-theme");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
  });

  it("システム追従のときは、いまどちらで表示しているかを補足する", () => {
    stubMatchMedia(true);
    render(<SettingsScreen user={null} />);

    expect(screen.getByText(/いまはダークで表示しています/)).toBeInTheDocument();
  });

  it("明示指定のときは配色の補足を出さない", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen user={null} />);

    await user.click(screen.getByRole("radio", { name: "ライト" }));

    expect(screen.queryByText(/いまは.*で表示しています/)).not.toBeInTheDocument();
  });

  it("テーマの3択はキーボードだけで変えられる", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen user={null} />);

    screen.getByRole("radio", { name: "ライト" }).focus();
    await user.keyboard("[Space]");

    expect(screen.getByRole("radio", { name: "ライト" })).toBeChecked();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
