import { render as baseRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme";
import { TemplateScreen } from "@/features/templates";
import { countNodes, TEMPLATES } from "@/features/templates";
import { getRepository, resetRepositoryForTests } from "@/lib/db";

/**
 * テンプレート画面の操作テスト（jsdom）。
 *
 * jsdom は実ブラウザではないので、以下はここでは検証していない:
 * - レイアウト・CSS Module の見え方（グリッド・罫線・プレビューの線画）
 * - ダークモードでのコントラスト
 *
 * ここで固定したいのは「選ぶと中身の入ったマップが**ローカルに**作られ、
 * エディタへ遷移する」こと。テンプレートは Should 扱いの機能だが、
 * 保存が絡むので壊れ方がデータに残る（CLAUDE.md §6）。
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  push.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function render(ui: ReactElement) {
  return baseRender(<ThemeProvider>{ui}</ThemeProvider>);
}

/** 一覧の項目を名前で引く。 */
function card(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name) });
}

describe("テンプレート画面", () => {
  it("すべてのテンプレートと「空のマップ」を出す", () => {
    render(<TemplateScreen signedIn={false} />);

    for (const template of TEMPLATES) {
      expect(screen.getByText(template.name)).toBeInTheDocument();
    }
    expect(screen.getByText("空のマップ")).toBeInTheDocument();
    expect(screen.getByText("START BLANK")).toBeInTheDocument();
  });

  it("分類で絞り込める。「空のマップ」はどの分類でも残る", async () => {
    const user = userEvent.setup();
    render(<TemplateScreen signedIn={false} />);

    await user.click(screen.getByRole("button", { name: "読書" }));

    expect(screen.getByText("読書メモ")).toBeInTheDocument();
    expect(screen.queryByText("SWOT 分析")).not.toBeInTheDocument();
    // 白紙から始める道はいつでも残す。
    expect(screen.getByText("空のマップ")).toBeInTheDocument();
  });

  it("テンプレートを選ぶと中身の入ったマップを作ってエディタへ移る", async () => {
    const user = userEvent.setup();
    render(<TemplateScreen signedIn={false} />);

    const swot = TEMPLATES.find((template) => template.id === "swot")!;
    await user.click(card(swot.name));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const href = push.mock.calls[0][0] as string;
    const id = new URL(href, "http://localhost").searchParams.get("map");
    expect(id).not.toBeNull();

    const saved = await getRepository().getMap(id as string);
    expect(saved).not.toBeNull();
    expect(saved?.nodes).toHaveLength(countNodes(swot.tree));
    expect(saved?.map.title).toBe(swot.name);
    // 木の中身がそのまま入っていること（表示名だけの張りぼてにしない）。
    expect(saved?.nodes.map((node) => node.text)).toContain("強み");
  });

  it("「空のマップ」はルート1つだけのマップを作る", async () => {
    const user = userEvent.setup();
    render(<TemplateScreen signedIn={false} />);

    await user.click(card("空のマップ"));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const href = push.mock.calls[0][0] as string;
    const id = new URL(href, "http://localhost").searchParams.get("map") as string;

    const saved = await getRepository().getMap(id);
    expect(saved?.nodes).toHaveLength(1);
    expect(saved?.nodes[0].parentId).toBeNull();
  });

  it("保存に失敗しても黙って終わらせず、その場で知らせる", async () => {
    const user = userEvent.setup();
    vi.spyOn(getRepository(), "createMap").mockRejectedValue(new Error("保存領域が使えません"));

    render(<TemplateScreen signedIn={false} />);
    await user.click(card("空のマップ"));

    expect(await screen.findByRole("alert")).toHaveTextContent("マップを作れませんでした");
    expect(push).not.toHaveBeenCalled();
  });

  it("広告帯はこの画面に置いてよい（枠の外に出さない）", () => {
    const { container } = render(<TemplateScreen signedIn={false} />);
    // 事業者 ID 未設定・NODE_ENV=test では何も描かないのが正しい挙動。
    expect(container.querySelector("[data-ad-client]")).toBeNull();
    // エディタ側に広告が出ていないことは tests/ads/placement.test.tsx が見ている。
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("現在の画面はナビで示される", () => {
    render(<TemplateScreen signedIn={false} />);
    const nav = screen.getByRole("navigation", { name: "画面" });
    expect(within(nav).getByRole("link", { name: "テンプレート" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
