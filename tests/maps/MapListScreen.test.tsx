import { act, render as baseRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/theme";
import { MapListScreen } from "@/features/maps";
import { getRepository, resetRepositoryForTests } from "@/lib/db";

/**
 * 一覧画面の操作テスト（jsdom）。
 *
 * jsdom は実ブラウザではないため、レイアウト・CSS Module の見え方・
 * フォーカスリングの実描画はここでは検証できていない。
 */

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * jsdom は matchMedia を持たない。ThemeProvider が OS のダークモード設定を
 * 購読するのに使うので、ライト固定のスタブを置く。
 * （共有の tests/setup.ts は担当 A の所有なので、ここで閉じて用意する）
 */
function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
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
 * jsdom 29 は <dialog> の showModal/close を実装していない。Modal は
 * ネイティブ dialog の上に組まれているので、最低限の挙動を足す。
 * フォーカストラップ・top layer・Esc はここでは再現されない（実ブラウザ側の責務）。
 */
function stubDialog() {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  if (typeof proto.showModal === "function") return;
  proto.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  push.mockClear();
  stubMatchMedia();
  stubDialog();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * 本番では RootLayout が ThemeProvider を張っている（AppHeader のテーマ切替が使う）。
 * テストでも同じ形で包む。
 */
function withTheme(ui: ReactElement) {
  return <ThemeProvider>{ui}</ThemeProvider>;
}

function render(ui: ReactElement) {
  return baseRender(withTheme(ui));
}

/** 行の <li> を、その中のマップ名で引く。 */
function row(title: string): HTMLElement {
  return screen.getByText(title).closest("li") as HTMLElement;
}

describe("MapListScreen（ゲスト）", () => {
  it("保存済みのマップを更新日時の新しい順に並べる", async () => {
    const repo = getRepository();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T00:00:00.000Z"));
    await repo.createMap("古いメモ");
    vi.setSystemTime(new Date("2026-09-13T00:05:00.000Z"));
    await repo.createMap("新しいメモ");
    vi.useRealTimers();

    render(<MapListScreen signedIn={false} />);

    await waitFor(() => expect(screen.getByText("古いメモ")).toBeInTheDocument());
    // サイドバーのナビゲーションリンクは数えない。
    const titles = within(screen.getByRole("list"))
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(titles).toEqual(["新しいメモ", "古いメモ"]);
  });

  it("マップが1件も無いときは案内を出す", async () => {
    render(<MapListScreen signedIn={false} />);
    expect(await screen.findByText(/まだマップがありません/)).toBeInTheDocument();
  });

  it("ゲストのままでも新しいマップを作ってエディタへ遷移する", async () => {
    const user = userEvent.setup();
    render(<MapListScreen signedIn={false} />);
    await screen.findByText(/まだマップがありません/);

    await user.click(screen.getByRole("button", { name: "新しいマップ" }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(String(push.mock.calls[0]?.[0])).toMatch(/^\/\?map=/);
    // ローカルにも確かに保存されている（ログイン不要）。
    expect(await getRepository().listMaps()).toHaveLength(1);
  });

  it("ゲストには同期状態を出さない", async () => {
    await getRepository().createMap("ゲストのマップ");
    render(<MapListScreen signedIn={false} />);

    await screen.findByText("ゲストのマップ");
    expect(screen.queryByText(/この端末のみ/)).not.toBeInTheDocument();
  });

  it("ログイン中は同期状態を出す", async () => {
    await getRepository().createMap("同期するマップ");
    render(<MapListScreen signedIn />);

    await screen.findByText("同期するマップ");
    expect(screen.getByText("この端末のみ")).toBeInTheDocument();
  });

  it("検索でタイトルを絞り込める", async () => {
    const user = userEvent.setup();
    const repo = getRepository();
    await repo.createMap("読書メモ");
    await repo.createMap("3Dプリンタ");

    render(<MapListScreen signedIn={false} />);
    await screen.findByText("読書メモ");

    await user.type(screen.getByRole("searchbox", { name: /検索/ }), "プリンタ");

    expect(screen.getByText("3Dプリンタ")).toBeInTheDocument();
    expect(screen.queryByText("読書メモ")).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: /検索/ }));
    expect(await screen.findByText("読書メモ")).toBeInTheDocument();
  });

  it("一致しない検索語では「ありません」と伝える", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("読書メモ");
    render(<MapListScreen signedIn={false} />);
    await screen.findByText("読書メモ");

    await user.type(screen.getByRole("searchbox", { name: /検索/ }), "存在しない語");
    expect(screen.getByText(/一致するマップがありません/)).toBeInTheDocument();
  });

  it("インライン編集で名前を変更できる", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("旧タイトル");
    render(<MapListScreen signedIn={false} />);
    await screen.findByText("旧タイトル");

    await user.click(within(row("旧タイトル")).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "マップ名" });
    await user.clear(input);
    await user.type(input, "新タイトル{Enter}");

    expect(await screen.findByText("新タイトル")).toBeInTheDocument();
    expect((await getRepository().listMaps())[0]?.title).toBe("新タイトル");
  });

  it("Esc で名前変更を取り消す", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("そのまま");
    render(<MapListScreen signedIn={false} />);
    await screen.findByText("そのまま");

    await user.click(within(row("そのまま")).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "マップ名" });
    await user.clear(input);
    await user.type(input, "書きかけ{Escape}");

    expect(await screen.findByText("そのまま")).toBeInTheDocument();
    expect((await getRepository().listMaps())[0]?.title).toBe("そのまま");
  });

  it("空のタイトルは保存しない", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("消せない名前");
    render(<MapListScreen signedIn={false} />);
    await screen.findByText("消せない名前");

    await user.click(within(row("消せない名前")).getByRole("button", { name: "名前を変更" }));
    const input = screen.getByRole("textbox", { name: "マップ名" });
    await user.clear(input);
    await user.type(input, "   {Enter}");

    expect(await screen.findByText("消せない名前")).toBeInTheDocument();
  });

  it("削除はブラウザの confirm を使わず、ダイアログで確認してから消す", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm");
    const doc = await getRepository().createMap("消すマップ");

    render(<MapListScreen signedIn={false} />);
    await screen.findByText("消すマップ");

    await user.click(
      within(row("消すマップ")).getByRole("button", { name: "「消すマップ」を削除" }),
    );

    // 確認するまでは消えない。
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(await getRepository().listMaps()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "削除する" }));

    await waitFor(() => expect(screen.queryByText("消すマップ")).not.toBeInTheDocument());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("「消すマップ」を削除しました。");

    // 論理削除なので中身は残っている（CLAUDE.md §6）。
    const buried = await getRepository().getMap(doc.map.id, { includeDeleted: true });
    expect(buried?.nodes).toHaveLength(doc.nodes.length);

    await user.click(screen.getByRole("button", { name: "元に戻す" }));
    expect(await screen.findByText("消すマップ")).toBeInTheDocument();
  });

  it("確認ダイアログをキャンセルすると削除しない", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("残すマップ");

    render(<MapListScreen signedIn={false} />);
    await screen.findByText("残すマップ");

    await user.click(
      within(row("残すマップ")).getByRole("button", { name: "「残すマップ」を削除" }),
    );
    await user.click(screen.getByRole("button", { name: "キャンセル" }));

    expect(screen.getByText("残すマップ")).toBeInTheDocument();
    expect(await getRepository().listMaps()).toHaveLength(1);
  });

  it("IndexedDB が使えないときは黙って失敗せず、生の例外も見せない", async () => {
    const repo = getRepository();
    const { IndexedDbUnavailableError } = await import("@/lib/db");
    vi.spyOn(repo, "listMaps").mockRejectedValue(
      new IndexedDbUnavailableError("InvalidStateError: backing store"),
    );

    render(<MapListScreen signedIn={false} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("マップ一覧を読み込めませんでした");
    expect(alert).not.toHaveTextContent("InvalidStateError");
    // 読めなかっただけなのに「0件です」と誤解させない。
    expect(screen.queryByText(/まだマップがありません/)).not.toBeInTheDocument();
  });

  it("サーバが返した HTML をそのままハイドレートできる（不一致を出さない）", async () => {
    // 相対日時をサーバ側で描くと、この検証が落ちる。
    await getRepository().createMap("ハイドレーション");
    const errors = vi.mocked(console.error);

    const container = document.createElement("div");
    container.innerHTML = renderToString(withTheme(<MapListScreen signedIn={false} />));
    document.body.appendChild(container);

    const root = await act(async () =>
      hydrateRoot(container, withTheme(<MapListScreen signedIn={false} />)),
    );
    await waitFor(() => expect(screen.getByText("ハイドレーション")).toBeInTheDocument());

    const messages = errors.mock.calls.map((call) => String(call[0]));
    expect(messages.filter((message) => /hydrat|did not match/i.test(message))).toEqual([]);

    act(() => root.unmount());
    container.remove();
  });

  it("検索欄から Tab で一覧の操作へ進める", async () => {
    const user = userEvent.setup();
    await getRepository().createMap("キーボード");
    render(<MapListScreen signedIn={false} />);
    await screen.findByText("キーボード");

    const search = screen.getByRole("searchbox", { name: /検索/ });
    search.focus();
    await user.tab(); // 新しいマップ
    expect(screen.getByRole("button", { name: "新しいマップ" })).toHaveFocus();
    await user.tab(); // マップを開くリンク
    expect(screen.getByRole("link", { name: "キーボード" })).toHaveFocus();
  });
});
