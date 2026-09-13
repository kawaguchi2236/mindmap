import { describe, expect, it } from "vitest";
import { inlineSvgPaintStyles } from "@/features/export";

/**
 * SVG の塗り・線をインライン化する処理の単体テスト。
 *
 * **何を検証できていないか（重要）**
 * jsdom は CSS のカスケードを適用しない（スタイルシートの規則は
 * getComputedStyle に反映されない）。そのためこのファイルでは
 * 「本物の `.react-flow__edge-path { stroke: … }` が解決されるか」は
 * 検証できず、インライン style を計算済み値の代役として使っている。
 * 検証できるのは **コピーする仕組みと、確実に元へ戻すこと** だけ。
 * 実際に線が PNG に写るかは実ブラウザでしか確認できない。
 */

/** React Flow v12 が実際に吐く構造（実装を読んで確認したもの）を模す。 */
function buildViewport(): HTMLElement {
  const viewport = document.createElement("div");
  viewport.className = "react-flow__viewport";
  viewport.innerHTML = `
    <div class="react-flow__edges">
      <svg style="overflow: visible; position: absolute">
        <g class="react-flow__edge react-flow__edge-default"
           style="stroke: rgb(32, 30, 29); stroke-width: 1px">
          <path class="react-flow__edge-path" d="M0,0 C10,0 10,10 20,10" fill="none" />
          <path class="react-flow__edge-interaction" d="M0,0 C10,0 10,10 20,10" fill="none" />
        </g>
      </svg>
    </div>
    <div class="react-flow__nodes">
      <div class="react-flow__node"><div class="mindmap-node">ノード</div></div>
    </div>
  `;
  document.body.append(viewport);
  return viewport;
}

describe("inlineSvgPaintStyles", () => {
  it("SVG の子孫に stroke を style 属性として焼き込む", () => {
    const viewport = buildViewport();
    const path = viewport.querySelector<SVGElement>(".react-flow__edge-path");
    if (path === null) throw new Error("テストの前提が壊れています");

    /*
     * 実機で線が消えるのは「計算済みスタイルには色があるのに、その要素自身の
     * style 属性には無い」状態だから（CSS 由来）。jsdom はスタイルシートを
     * 解決しないので、同じ状態を親からの継承で作っている。
     */
    expect(path.hasAttribute("style")).toBe(false);

    const restore = inlineSvgPaintStyles(viewport);

    // 「複製後に CSS が無くても線が残る」ために必要なのは style 属性の存在。
    expect(path.getAttribute("style")).toContain("stroke");
    expect(path.style.getPropertyValue("stroke")).toBe("rgb(32, 30, 29)");
    expect(path.style.getPropertyValue("stroke-width")).toBe("1px");

    restore();
    viewport.remove();
  });

  it("`<g>` など中間のノードにも焼き込む（fill の継承が消えないように）", () => {
    const viewport = buildViewport();
    const group = viewport.querySelector<SVGElement>("g");
    if (group === null) throw new Error("テストの前提が壊れています");

    const restore = inlineSvgPaintStyles(viewport);
    expect(group.getAttribute("style")).toContain("fill");

    restore();
    viewport.remove();
  });

  it("戻す関数を呼ぶと DOM が元どおりになる（画面に痕跡を残さない）", () => {
    const viewport = buildViewport();
    const before = viewport.innerHTML;

    const restore = inlineSvgPaintStyles(viewport);
    expect(viewport.innerHTML).not.toBe(before);

    restore();
    expect(viewport.innerHTML).toBe(before);

    viewport.remove();
  });

  it("元から style 属性が無かった要素には属性を残さない", () => {
    const viewport = buildViewport();
    const interaction = viewport.querySelector<SVGElement>(".react-flow__edge-interaction");
    if (interaction === null) throw new Error("テストの前提が壊れています");
    expect(interaction.hasAttribute("style")).toBe(false);

    const restore = inlineSvgPaintStyles(viewport);
    restore();

    expect(interaction.hasAttribute("style")).toBe(false);
    viewport.remove();
  });

  it("SVG の外にある HTML には触らない（html-to-image が面倒を見るため）", () => {
    const viewport = buildViewport();
    const node = viewport.querySelector<HTMLElement>(".mindmap-node");
    if (node === null) throw new Error("テストの前提が壊れています");

    const restore = inlineSvgPaintStyles(viewport);
    expect(node.hasAttribute("style")).toBe(false);

    restore();
    viewport.remove();
  });

  it("SVG が無くても、root が null でも壊れない", () => {
    const empty = document.createElement("div");
    expect(() => inlineSvgPaintStyles(empty)()).not.toThrow();
    expect(() => inlineSvgPaintStyles(null)()).not.toThrow();
  });
});
