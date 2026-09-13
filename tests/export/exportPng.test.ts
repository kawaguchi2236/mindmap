import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPORT_PADDING, exportMapToPng, findViewportElement } from "@/features/export";
import type { RenderToPng, SavePng } from "@/features/export/exportPng";

/**
 * 書き出し処理の単体テスト（jsdom）。
 *
 * **jsdom は canvas も SVG も描画しない。** ここで検証できるのは
 * 「html-to-image に渡す幅・高さ・transform・背景色・ファイル名」までで、
 * 出てきた PNG にノードやエッジが正しく写っているか、テキストが切れないか、
 * フォントが埋め込まれるかは一切確認できていない（実ブラウザで確認すること）。
 */

const PNG = "data:image/png;base64,AAAA";

interface RenderCall {
  element: HTMLElement;
  options: Parameters<RenderToPng>[1];
}

function setup() {
  const container = document.createElement("div");
  container.className = "react-flow";
  const viewport = document.createElement("div");
  viewport.className = "react-flow__viewport";
  container.append(viewport);
  document.body.append(container);

  const calls: RenderCall[] = [];
  const render: RenderToPng = async (element, options) => {
    calls.push({ element, options });
    return PNG;
  };
  return { viewport, container, calls, render, save: vi.fn<SavePng>() };
}

/** `translate(Xpx, Ypx) scale(Z)` を数値に戻す。 */
function parseTransform(transform: string | undefined): { x: number; y: number; zoom: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(
    transform ?? "",
  );
  if (!match) throw new Error(`transform を解釈できません: ${String(transform)}`);
  return { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("exportMapToPng", () => {
  it("外接矩形に余白を足した大きさで描画する", async () => {
    const { viewport, calls, render, save } = setup();

    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 400, height: 200 },
      title: "計画",
      render,
      save,
    });

    expect(result).toMatchObject({ ok: true, fileName: "計画.png", scale: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].element).toBe(viewport);
    expect(calls[0].options.width).toBe(400 + EXPORT_PADDING * 2);
    expect(calls[0].options.height).toBe(200 + EXPORT_PADDING * 2);
    expect(calls[0].options.style.width).toBe(`${400 + EXPORT_PADDING * 2}px`);
    expect(calls[0].options.style.height).toBe(`${200 + EXPORT_PADDING * 2}px`);
    expect(save).toHaveBeenCalledWith(PNG, "計画.png");
  });

  it("原点から離れた矩形でも、マップ全体が余白付きで収まる transform を作る", async () => {
    const { viewport, calls, render, save } = setup();

    const bounds = { x: 1200, y: -800, width: 400, height: 200 };
    await exportMapToPng({ viewport, bounds, title: "m", render, save });

    const { x, y, zoom } = parseTransform(calls[0].options.style.transform);
    expect(zoom).toBe(1);
    // 左上の余白ぶんだけ内側に寄る ＝ 矩形の左上が (padding, padding) に来る。
    expect(x).toBeCloseTo(EXPORT_PADDING - bounds.x, 6);
    expect(y).toBeCloseTo(EXPORT_PADDING - bounds.y, 6);
    // 右下も同じだけ余白が残る（切り詰めていない）。
    expect(calls[0].options.width - (bounds.x + bounds.width + x)).toBeCloseTo(EXPORT_PADDING, 6);
    expect(calls[0].options.height - (bounds.y + bounds.height + y)).toBeCloseTo(EXPORT_PADDING, 6);
  });

  /**
   * CLAUDE.md §16 の核心。現在のズーム・スクロール位置で結果が変わってはいけない。
   * （この検証を外すと「見えている範囲だけ書き出す」実装に退行しても気づけない）
   */
  it("現在のズーム・スクロール位置に結果が左右されない", async () => {
    const bounds = { x: 100, y: 50, width: 640, height: 480 };

    const first = setup();
    first.viewport.style.transform = "translate(0px, 0px) scale(1)";
    await exportMapToPng({
      viewport: first.viewport,
      bounds,
      title: "m",
      render: first.render,
      save: first.save,
    });

    document.body.innerHTML = "";

    const second = setup();
    // 大きくズームアウトして、まったく別の場所までスクロールした状態。
    second.viewport.style.transform = "translate(-4321px, 987px) scale(0.23)";
    await exportMapToPng({
      viewport: second.viewport,
      bounds,
      title: "m",
      render: second.render,
      save: second.save,
    });

    expect(second.calls[0].options.width).toBe(first.calls[0].options.width);
    expect(second.calls[0].options.height).toBe(first.calls[0].options.height);
    expect(second.calls[0].options.style.transform).toBe(first.calls[0].options.style.transform);
  });

  it("上限を超える大きさのときは縮小して出し、そのことを結果で伝える", async () => {
    const { viewport, calls, render, save } = setup();

    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 40_000, height: 20_000 },
      title: "大きいマップ",
      limits: { padding: 0, maxDimension: 2000, maxPixels: Number.MAX_SAFE_INTEGER },
      render,
      save,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scale).toBeLessThan(1);
    expect(result.width).toBeLessThanOrEqual(2000);
    expect(result.height).toBeLessThanOrEqual(2000);

    const { zoom } = parseTransform(calls[0].options.style.transform);
    expect(zoom).toBeCloseTo(result.scale, 10);
    // 縮小しても縦横比は保たれる ＝ 黙って切り詰めていない。
    expect(result.width / result.height).toBeCloseTo(2, 2);
  });

  it("背景色を必ず指定する（透過 PNG にしない）", async () => {
    const { viewport, container, calls, render, save } = setup();
    container.style.backgroundColor = "rgb(26, 25, 24)";

    await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "m",
      render,
      save,
    });

    expect(calls[0].options.backgroundColor).toBe("rgb(26, 25, 24)");
  });

  it("背景色を明示されたらそれを使う", async () => {
    const { viewport, calls, render, save } = setup();
    await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "m",
      backgroundColor: "#123456",
      render,
      save,
    });
    expect(calls[0].options.backgroundColor).toBe("#123456");
  });

  it("ノードが無いときは保存せず、理由を返す", async () => {
    const { viewport, calls, render, save } = setup();
    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      title: "m",
      render,
      save,
    });
    expect(result).toEqual({ ok: false, message: "書き出せるノードがありません。" });
    expect(calls).toHaveLength(0);
    expect(save).not.toHaveBeenCalled();
  });

  it("キャンバスが見つからないときも例外を投げない", async () => {
    const { save } = setup();
    const result = await exportMapToPng({
      viewport: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "m",
      save,
    });
    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("画像化が失敗しても例外を投げず、生のエラーも見せない", async () => {
    const { viewport, save } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "m",
      render: () => Promise.reject(new Error("canvas is tainted at foo.js:1:2")),
      save,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).not.toContain("foo.js");
    expect(result.message).toContain("もう一度");
    expect(save).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it("PNG 以外が返ってきたら保存しない", async () => {
    const { viewport, save } = setup();
    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "m",
      render: async () => "",
      save,
    });
    expect(result.ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("壊れたタイトルでもファイル名が壊れない", async () => {
    const { viewport, save } = setup();
    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      title: "  ../a/b  ",
      render: async () => PNG,
      save,
    });
    expect(result).toMatchObject({ ok: true, fileName: "a b.png" });
    expect(save).toHaveBeenCalledWith(PNG, "a b.png");
  });
});

describe("findViewportElement", () => {
  it("同じ React Flow の viewport を返す", () => {
    const { viewport, container } = setup();
    const button = document.createElement("button");
    container.append(button);
    expect(findViewportElement(button)).toBe(viewport);
  });

  it("React Flow の外なら null を返す", () => {
    setup();
    const stray = document.createElement("button");
    document.body.append(stray);
    expect(findViewportElement(stray)).toBeNull();
    expect(findViewportElement(null)).toBeNull();
  });
});

/**
 * 実機で「ノードは写るのにエッジが1本も写らない」不具合が出たため、その再発防止。
 *
 * 原因は html-to-image が SVG の子孫にインラインスタイルを付けないこと
 * （src/features/export/svgStyles.ts に根拠を記載）。ここで固定できるのは
 * **画像化の瞬間にエッジの線の指定が DOM 上に存在すること**と
 * **終わったら必ず元に戻すこと**の2点だけ。
 * jsdom は SVG を描画しないので「本当に線が写るか」は検証できていない。
 */
describe("エッジの線を写すための下ごしらえ", () => {
  function addEdge(viewport: HTMLElement): SVGElement {
    const edges = document.createElement("div");
    edges.className = "react-flow__edges";
    /*
     * 線の指定を path 自身の style 属性には置かない。実機では
     * `.react-flow__edge-path { stroke: … }` という「CSS にしか無い」状態で、
     * それこそが html-to-image で消える条件だから。
     * jsdom はスタイルシートを解決しないので、同じ条件（計算済みスタイルには
     * 現れるが、その要素自身の style 属性には無い）を継承で作る。
     */
    edges.innerHTML = `
      <svg style="overflow: visible; position: absolute">
        <g class="react-flow__edge" style="stroke: rgb(32, 30, 29); stroke-width: 1px">
          <path class="react-flow__edge-path" d="M0,0 C10,0 10,10 20,10" fill="none" />
        </g>
      </svg>`;
    viewport.append(edges);
    const path = viewport.querySelector<SVGElement>(".react-flow__edge-path");
    if (path === null) throw new Error("テストの前提が壊れています");
    return path;
  }

  it("画像化の瞬間、エッジの線が style 属性として焼き込まれている", async () => {
    const { viewport, save } = setup();
    const path = addEdge(viewport);

    // 下ごしらえの前は、path 自身は線の指定を持っていない。
    expect(path.hasAttribute("style")).toBe(false);

    let strokeAtRenderTime: string | null = null;
    await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      title: "m",
      render: async () => {
        strokeAtRenderTime = path.style.getPropertyValue("stroke");
        return PNG;
      },
      save,
    });

    expect(strokeAtRenderTime).toBe("rgb(32, 30, 29)");
  });

  it("書き出しが終わったら DOM を元に戻す（画面に痕跡を残さない）", async () => {
    const { viewport, save } = setup();
    addEdge(viewport);
    const before = viewport.innerHTML;

    await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      title: "m",
      render: async () => PNG,
      save,
    });

    expect(viewport.innerHTML).toBe(before);
  });

  it("画像化が失敗しても DOM を元に戻す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { viewport, save } = setup();
    addEdge(viewport);
    const before = viewport.innerHTML;

    const result = await exportMapToPng({
      viewport,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      title: "m",
      render: () => Promise.reject(new Error("boom")),
      save,
    });

    expect(result.ok).toBe(false);
    expect(viewport.innerHTML).toBe(before);
  });
});
