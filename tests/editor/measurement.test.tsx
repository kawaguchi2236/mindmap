import { fireEvent, render, act } from "@testing-library/react";
import { StrictMode, useState, type ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { createMapDocument, createNode } from "@/lib/model/factory";
import type { MindMapDocument } from "@/lib/model/types";

/**
 * 実機で起きた「ノードが visibility: hidden のまま出てこない」不具合の回帰テスト。
 *
 * React Flow は採寸できていないノードを visibility: hidden で描く。採寸は
 * ResizeObserver → updateNodeInternals → onNodesChange → applyNodeChanges →
 * ノードの measured、という経路でしか入らない。jsdom はレイアウトを計算しない
 * ので、この経路が動くところまでを最小限スタブして本物の React Flow を通す。
 */

interface FakeObserver {
  targets: Set<Element>;
  callback: ResizeObserverCallback;
}

const observers: FakeObserver[] = [];

/**
 * 観測中の全要素について採寸完了を通知する。
 * 本物の ResizeObserver はコミット後に非同期で発火するので、act の外で
 * コールバックを呼んでから React に処理させる。
 */
async function flushMeasurements(): Promise<void> {
  for (const observer of observers) {
    const entries = [...observer.targets].map(
      (target) =>
        ({
          target,
          contentRect: { width: 180, height: 44, top: 0, left: 0, bottom: 44, right: 180 },
        }) as unknown as ResizeObserverEntry,
    );
    if (entries.length > 0) {
      observer.callback(entries, null as unknown as ResizeObserver);
    }
  }
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * 実際の画面と同じく、onChange のたびに新しい document を渡し直す親。
 * 保存層は map.version / updatedAt を進めて新しいオブジェクトを流してくる。
 */
function Host({ initial }: { initial: MindMapDocument }): ReactElement {
  const [doc, setDoc] = useState(initial);
  return (
    <MindMapEditor
      document={doc}
      onChange={(next) =>
        setDoc({
          ...next,
          map: { ...next.map, version: next.map.version + 1, updatedAt: new Date().toISOString() },
        })
      }
    />
  );
}

/**
 * リロード直後と同じ状態のドキュメント。ルート＋子2つが最初から揃っていて、
 * どのノードもまだ一度も採寸されていない。
 */
function documentWithChildren(): MindMapDocument {
  const doc = createMapDocument({ title: "テスト" }, "ルート");
  const root = doc.nodes[0];
  const children = ["子A", "子B"].map((text, i) =>
    createNode({ mapId: doc.map.id, parentId: root.id, text, order: i, x: 244, y: i * 60 }),
  );
  return { ...doc, nodes: [root, ...children] };
}

function edgePathCount(): number {
  return document.querySelectorAll(".react-flow__edge-path").length;
}

function nodeVisibilities(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(
    (el) => el.style.visibility || "visible",
  );
}

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>;

  globals.ResizeObserver = class {
    private entry: FakeObserver;
    constructor(callback: ResizeObserverCallback) {
      this.entry = { targets: new Set(), callback };
      observers.push(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.add(target);
    }
    unobserve(target: Element): void {
      this.entry.targets.delete(target);
    }
    disconnect(): void {
      this.entry.targets.clear();
    }
  };

  globals.DOMMatrixReadOnly = class {
    m22 = 1;
  };

  // jsdom はレイアウトを持たないので、React Flow が読む実寸だけ与える。
  for (const [prop, value] of [
    ["offsetWidth", 180],
    ["offsetHeight", 44],
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
  observers.length = 0;
});

describe("ノードの採寸", () => {
  /*
   * ここが今回の回帰テスト。
   * 実機では「Tab で足したノードが visibility: hidden のまま出てこない」
   * 状態になり、textarea が hidden を継承してフォーカスできず文字が打てなかった。
   * 採寸（flushMeasurements）を一度も起こさずに、それでも全ノードが描画対象に
   * なることを確かめる。toFlowNodes の initialWidth / initialHeight が無いと落ちる。
   */
  it("採寸を待たずに、追加直後のノードも表示される", () => {
    const doc = createMapDocument({ title: "テスト" }, "ルート");
    render(
      <StrictMode>
        <Host initial={doc} />
      </StrictMode>,
    );
    expect(nodeVisibilities()).toEqual(["visible"]);

    // Tab で子ノードを作る。採寸は意図的に走らせない。
    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });

    expect(nodeVisibilities()).toEqual(["visible", "visible"]);
  });

  it("追加直後のノードは即編集モードになり、入力欄にフォーカスが当たる", () => {
    const doc = createMapDocument({ title: "テスト" }, "ルート");
    render(
      <StrictMode>
        <Host initial={doc} />
      </StrictMode>,
    );
    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });

    const textarea = document.querySelector<HTMLTextAreaElement>(".mindmap-node__input");
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    /*
     * jsdom の focus() は visibility を見ないので、上の assert だけでは
     * 実機の「hidden でフォーカスできない」状態を捕まえられない。
     * 入力欄を抱えているノードが hidden でないことも確かめる。
     */
    const wrapper = textarea?.closest<HTMLElement>(".react-flow__node");
    expect(wrapper?.style.visibility).not.toBe("hidden");
  });

  /*
   * リロード後にエッジが1本も描かれなかった退行のテスト。
   * React Flow はエッジの端点を handleBounds から決めるが、handleBounds は
   * measured か、明示した handles からしか作られない。initialWidth だけでは
   * 足りず、全ノードが未採寸で現れるリロード直後は 0 本になっていた。
   * 採寸を一度も起こさずにエッジが描かれることを確かめる。
   */
  it("採寸を待たずにエッジが描画される（リロード相当）", () => {
    render(
      <StrictMode>
        <Host initial={documentWithChildren()} />
      </StrictMode>,
    );

    expect(nodeVisibilities()).toEqual(["visible", "visible", "visible"]);
    // ルート→子A、ルート→子B の2本
    expect(edgePathCount()).toBe(2);
  });

  it("採寸が届いたあともエッジは描画されたまま", async () => {
    render(
      <StrictMode>
        <Host initial={documentWithChildren()} />
      </StrictMode>,
    );
    await flushMeasurements();

    expect(edgePathCount()).toBe(2);
  });

  it("採寸結果が届いても表示されたまま（measured が measured を上書きする）", async () => {
    const doc = createMapDocument({ title: "テスト" }, "ルート");
    render(
      <StrictMode>
        <Host initial={doc} />
      </StrictMode>,
    );
    await flushMeasurements();
    expect(nodeVisibilities()).toEqual(["visible"]);

    act(() => {
      fireEvent.keyDown(window, { key: "Tab" });
    });
    await flushMeasurements();

    expect(nodeVisibilities()).toEqual(["visible", "visible"]);
  });
});
