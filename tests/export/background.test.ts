import { describe, expect, it } from "vitest";
import {
  FALLBACK_BACKGROUND_DARK,
  FALLBACK_BACKGROUND_LIGHT,
  fallbackBackgroundColor,
  isOpaqueColor,
  resolveBackgroundColor,
} from "@/features/export/background";

/**
 * 背景色の決定ロジック。
 * jsdom は CSS 変数もカスケードもほぼ解決しないので、ここで見ているのは
 * 「透明かどうかの判定」と「祖先を辿る動き」だけ。実際にダークモードで
 * 正しい色が出るかは実ブラウザで確認すること。
 */
describe("isOpaqueColor", () => {
  it("不透明な色は採用する", () => {
    for (const color of ["#fff", "#1a1918", "rgb(26, 25, 24)", "rgb(0, 0, 0)", "white"]) {
      expect(isOpaqueColor(color)).toBe(true);
    }
  });

  it("透明・未指定は採用しない", () => {
    for (const color of ["", "   ", "transparent", "rgba(0, 0, 0, 0)", "rgb(255 255 255 / 0)"]) {
      expect(isOpaqueColor(color)).toBe(false);
    }
    expect(isOpaqueColor(null)).toBe(false);
    expect(isOpaqueColor(undefined)).toBe(false);
  });

  it("半透明でも下が透けるが、真っ透明でなければ採用する", () => {
    expect(isOpaqueColor("rgba(0, 0, 0, 0.5)")).toBe(true);
    expect(isOpaqueColor("rgba(0, 0, 0, 0%)")).toBe(false);
  });

  it("8 桁 hex のアルファも見る", () => {
    expect(isOpaqueColor("#11223300")).toBe(false);
    expect(isOpaqueColor("#112233ff")).toBe(true);
  });
});

describe("fallbackBackgroundColor", () => {
  it("data-theme に従う", () => {
    const dark = document.createElement("html");
    dark.setAttribute("data-theme", "dark");
    expect(fallbackBackgroundColor(dark)).toBe(FALLBACK_BACKGROUND_DARK);

    const light = document.createElement("html");
    light.setAttribute("data-theme", "light");
    expect(fallbackBackgroundColor(light)).toBe(FALLBACK_BACKGROUND_LIGHT);
  });

  it("指定が無ければ OS 設定を見る（テストのスタブは常にライト）", () => {
    expect(fallbackBackgroundColor(null)).toBe(FALLBACK_BACKGROUND_LIGHT);
  });
});

describe("resolveBackgroundColor", () => {
  it("祖先を辿って最初の不透明な背景色を返す", () => {
    const outer = document.createElement("div");
    outer.style.backgroundColor = "rgb(10, 20, 30)";
    const middle = document.createElement("div");
    const inner = document.createElement("div");
    middle.append(inner);
    outer.append(middle);
    document.body.append(outer);

    expect(resolveBackgroundColor(inner)).toBe("rgb(10, 20, 30)");
    outer.remove();
  });

  it("どこにも背景色が無ければ透明ではなく保険の色を返す", () => {
    const orphan = document.createElement("div");
    expect(resolveBackgroundColor(orphan)).toBe(FALLBACK_BACKGROUND_LIGHT);
    expect(resolveBackgroundColor(null)).toBe(FALLBACK_BACKGROUND_LIGHT);
  });
});
