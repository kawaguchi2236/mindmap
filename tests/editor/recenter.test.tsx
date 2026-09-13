import { fireEvent, render, act, screen } from "@testing-library/react";
import { StrictMode, useState, type ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { createMapDocument } from "@/lib/model/factory";
import type { MindMapDocument } from "@/lib/model/types";

/**
 * 「中央へ戻る」と初回センタリングの回帰テスト。
 *
 * 実機では初回センタリングが一度も走らず、ルートが画面左上に出ていた。
 * 原因は条件に useNodesInitialized() を使っていたこと。これはノードが実測
 * されるまで true にならないが、このエディタは固定寸法を渡して実測を待たない
 * 作りなので、条件が永久に false のままだった。
 *
 * jsdom は採寸しないので、実機と同じ「measured が一度も入らない」状況に
 * なる。つまりこのテストはその壊れ方をそのまま再現できる。
 */

/** setCenter の呼び出しを記録する。実体はそのまま呼ぶ。 */
const setCenterCalls: unknown[][] = [];

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    useReactFlow: () => {
      const instance = actual.useReactFlow();
      return {
        ...instance,
        setCenter: (...args: unknown[]) => {
          setCenterCalls.push(args);
          return (instance.setCenter as (...a: unknown[]) => unknown)(...args);
        },
      };
    },
  };
});

function Host({ initial }: { initial: MindMapDocument }): ReactElement {
  const [doc, setDoc] = useState(initial);
  return <MindMapEditor document={doc} onChange={setDoc} />;
}

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  /*
   * 実機と同じ振る舞いにする。キャンバス本体の寸法は ResizeObserver 経由で
   * 届くが、ノードの実測は最後まで届かない（実機で measured が null のまま
   * だったのを確認済み）。ノード要素には発火させないことでそれを再現する。
   */
  globals.ResizeObserver = class {
    constructor(private cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      if (target.getAttribute("data-id")) return; // ノードは採寸されない
      this.cb(
        [{ target, contentRect: { width: 1200, height: 800 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve(): void {}
    disconnect(): void {}
  };
  globals.DOMMatrixReadOnly = class {
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

beforeEach(() => {
  setCenterCalls.length = 0;
});

describe("センタリング", () => {
  it("初回表示でルートを中央に寄せる（採寸を待たない）", () => {
    render(
      <StrictMode>
        <Host initial={createMapDocument({ title: "テスト" }, "ルート")} />
      </StrictMode>,
    );

    expect(setCenterCalls.length).toBeGreaterThan(0);
    // ルートは (0,0)。ノード中心 (90, 22) を渡している。
    expect(setCenterCalls[0].slice(0, 2)).toEqual([90, 22]);
  });

  it("「中央へ戻る」でルート中心を指定して呼び直す", () => {
    render(
      <StrictMode>
        <Host initial={createMapDocument({ title: "テスト" }, "ルート")} />
      </StrictMode>,
    );
    setCenterCalls.length = 0;

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "中央へ戻る" }));
    });

    expect(setCenterCalls).toHaveLength(1);
    expect(setCenterCalls[0].slice(0, 2)).toEqual([90, 22]);
  });
});
