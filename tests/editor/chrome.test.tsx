import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState, type ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { createMapDocument } from "@/lib/model/factory";
import type { MindMapDocument } from "@/lib/model/types";

/**
 * エディタのクローム（design/ハンドオフ.md `#2b`）の検証。
 *
 * `#2b` はヘッダーバーを持たない案で、マップ名・保存状態・履歴・書き出し・
 * ショートカットのヒント・倍率をキャンバスの四隅に浮かべる。常設ツールバーは
 * 持たず、選択中のノードにだけコンテキストツールバーを出す。
 * 「道具がどこにも無い」状態に退行していないかをここで固定する。
 *
 * jsdom なので以下は検証できない。実ブラウザで確認すること:
 * - 四隅の座標・トンボの見え方・浮かぶツールバーの影
 * - PNG 書き出し画像にクロームが写らないこと（Panel が viewport の外にある根拠）
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.ResizeObserver ??= class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.cb(
        [{ target, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  };
  globals.DOMMatrixReadOnly ??= class {
    m22 = 1;
  };
  for (const [prop, value] of [
    ["offsetWidth", 1200],
    ["offsetHeight", 800],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() {
        return value;
      },
    });
  }
});

function Host({ initial, status }: { initial: MindMapDocument; status?: string }): ReactElement {
  const [doc, setDoc] = useState(initial);
  return <MindMapEditor document={doc} onChange={setDoc} status={status} />;
}

function mount(status?: string) {
  const doc = createMapDocument({ title: "設計メモ" }, "ルート");
  return render(<Host initial={doc} status={status} />);
}

describe("四隅のクローム", () => {
  it("左上にマップ名と保存状態を出す", () => {
    mount("保存済み 12:34");
    expect(screen.getByText("設計メモ")).toBeInTheDocument();
    expect(screen.getByText("保存済み 12:34")).toBeInTheDocument();
  });

  it("状態が空のときは状態表示そのものを出さない（役に立つときだけ出す）", () => {
    const { container } = mount("");
    expect(container.querySelector(".mindmap-chrome__status")).toBeNull();
  });

  it("右上に履歴・書き出し・設定への導線を出す", () => {
    mount();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "やり直す" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "マップを PNG で書き出す" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "設定" })).toHaveAttribute("href", "/settings");
  });

  /**
   * エディタは `/` なので、直接ここへ来るとブラウザの戻るでは一覧へ辿り着けない。
   * 「マップを開いたら出られない」状態に退行していないかを固定する。
   */
  it("マップ一覧へ戻れる（右上の導線と、左上のマップ名の両方から）", () => {
    mount();
    expect(screen.getByRole("link", { name: "マップ一覧" })).toHaveAttribute("href", "/maps");
    // 左上はマップ名 + 読み上げ用の説明が名前になる。
    expect(screen.getByRole("link", { name: /設計メモ/ })).toHaveAttribute("href", "/maps");
  });

  it("何もしていないうちは Undo / Redo を押せない", () => {
    mount();
    expect(screen.getByRole("button", { name: "元に戻す" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "やり直す" })).toBeDisabled();
  });

  it("編集したら Undo が押せるようになり、押すと戻る", () => {
    mount();
    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });
    const undo = screen.getByRole("button", { name: "元に戻す" });
    expect(undo).toBeEnabled();

    act(() => {
      fireEvent.click(undo);
    });
    expect(screen.getByRole("button", { name: "やり直す" })).toBeEnabled();
    // ルートだけに戻っている。
    expect(screen.getByText("ROOT · 1 NODES")).toBeInTheDocument();
  });

  it("左下にショートカットのヒント、右下に倍率とキャンバス操作を出す", () => {
    mount();
    expect(screen.getByText("Tab 子ノード")).toBeInTheDocument();
    expect(screen.getByText("Enter 同階層")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拡大" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "縮小" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "中央へ戻る" })).toBeInTheDocument();
  });

  it("ルートの下にノード数を出す", () => {
    mount();
    expect(screen.getByText("ROOT · 1 NODES")).toBeInTheDocument();
    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });
    expect(screen.getByText("ROOT · 2 NODES")).toBeInTheDocument();
  });
});

describe("コンテキストツールバー", () => {
  /** 浮かぶツールバー。常設ではないので、選択があるときだけ存在する。 */
  function toolbar(): HTMLElement | null {
    return document.querySelector(".mindmap-toolbar");
  }

  it("選択中のノードに出る", () => {
    mount();
    // createInitialState はルートを選択した状態で始まる。
    const bar = toolbar();
    expect(bar).not.toBeNull();
    expect(within(bar as HTMLElement).getByText("SELECTED")).toBeInTheDocument();
  });

  it("選択を外すと消える（常設ツールバーを持たない）", () => {
    mount();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(toolbar()).toBeNull();
  });

  it("ルートには削除を出さない（マップに1つだけなので消せない）", () => {
    mount();
    const bar = toolbar() as HTMLElement;
    expect(within(bar).queryByRole("button", { name: "削除" })).toBeNull();
    expect(within(bar).getByRole("button", { name: "子ノードを追加" })).toBeInTheDocument();
  });

  it("子ノードを追加できる", () => {
    mount();
    act(() => {
      fireEvent.click(
        within(toolbar() as HTMLElement).getByRole("button", { name: "子ノードを追加" }),
      );
    });
    expect(screen.getByText("ROOT · 2 NODES")).toBeInTheDocument();
  });

  it("折りたたむと子数のバッジが出て、押すと開く", () => {
    mount();
    // ルートに子を1つ作り、編集を抜けてからルートを選び直す。
    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    act(() => {
      fireEvent.keyDown(window, { key: "ArrowLeft" });
    });

    act(() => {
      fireEvent.click(within(toolbar() as HTMLElement).getByRole("button", { name: "折りたたむ" }));
    });

    const badge = screen.getByRole("button", { name: "子ノードを開く" });
    expect(badge).toHaveTextContent("1");

    act(() => {
      fireEvent.click(badge);
    });
    expect(screen.queryByRole("button", { name: "子ノードを開く" })).toBeNull();
  });
});
