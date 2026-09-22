import { fireEvent, render, act, screen } from "@testing-library/react";
import { StrictMode, useState, type ReactElement } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MindMapEditor } from "@/features/editor/MindMapEditor";
import { layoutTree, nodeBox } from "@/features/editor/layout";
import { nodesBounds, toFlowNodes } from "@/features/editor/flowNodes";
import { getVisibleNodes } from "@/features/editor/tree";
import { createMapDocument } from "@/lib/model/factory";
import type { MindMapDocument } from "@/lib/model/types";
import { buildTree } from "./helpers";

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

/** (0,0) に置かれたルート「ルート」の中心。 */
function rootCenter(): [number, number] {
  const box = nodeBox("ルート", 0);
  return [box.width / 2, box.height / 2];
}

/** 枝のある木のドキュメント。テンプレートから開いた直後と同じ形。 */
function branchedDocument(): MindMapDocument {
  const base = createMapDocument({ title: "テスト" }, "ルート");
  const nodes = layoutTree(
    buildTree({
      text: "ルート",
      children: [
        { text: "外部環境（動かせない）", children: [{ text: "機会 O" }, { text: "脅威 T" }] },
        { text: "内部環境（変えられる）", children: [{ text: "強み S" }, { text: "弱み W" }] },
      ],
    }),
  ).map((node) => ({ ...node, mapId: base.map.id }));
  return { ...base, nodes };
}

/** 外接矩形の中心。実装と同じ純関数から求める。 */
function boundsCenter(doc: MindMapDocument): [number, number] {
  const flow = toFlowNodes(getVisibleNodes(doc.nodes), {
    selectedId: null,
    editingId: null,
    childCounts: new Map(),
    totalCount: doc.nodes.length,
  });
  const box = nodesBounds(flow);
  if (!box) throw new Error("外接矩形が求まりません");
  return [box.x + box.width / 2, box.y + box.height / 2];
}

describe("センタリング", () => {
  it("初回表示でルートを中央に寄せる（採寸を待たない）", () => {
    render(
      <StrictMode>
        <Host initial={createMapDocument({ title: "テスト" }, "ルート")} />
      </StrictMode>,
    );

    expect(setCenterCalls.length).toBeGreaterThan(0);
    // ルートは (0,0)。ノードの中心を渡している（大きさはルートの文字組みで決まる）。
    expect(setCenterCalls[0].slice(0, 2)).toEqual(rootCenter());
  });

  /**
   * ルートを画面中央に置くと、右へ伸びる木では左半分が空くだけで子が画面外に出る。
   * テンプレートから開いた直後がまさにこれで、型がほとんど見えなかった。
   * 等倍で収まる木は外接矩形の中心に寄せる（ズームは変えない）。
   */
  it("枝のある木は木全体が収まる位置に寄せる（ルート中心ではない）", () => {
    const doc = branchedDocument();
    render(
      <StrictMode>
        <Host initial={doc} />
      </StrictMode>,
    );

    expect(setCenterCalls.length).toBeGreaterThan(0);
    expect(setCenterCalls[0].slice(0, 2)).toEqual(boundsCenter(doc));
    // ルート中心のままなら右側が見えない。直っていることを明示的に見る。
    const [x] = setCenterCalls[0] as [number, number];
    expect(x).toBeGreaterThan(rootCenter()[0]);
    // 倍率は動かさない（勝手に縮めて読めなくしない）。
    expect(setCenterCalls[0][2]).toMatchObject({ zoom: 1 });
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
    expect(setCenterCalls[0].slice(0, 2)).toEqual(rootCenter());
  });
});
