import { describe, expect, it } from "vitest";
import {
  computeExportGeometry,
  EXPORT_PADDING,
  formatScale,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
} from "@/features/export";

/**
 * 出力サイズ計算の単体テスト。
 *
 * ここで検証できるのは「どんな幅・高さ・倍率を html-to-image に渡すか」まで。
 * その値で実際に画像が正しく描かれるか（フォント・SVG のエッジ・影）は
 * jsdom では一切評価されない。実ブラウザで確認すること。
 */
describe("computeExportGeometry", () => {
  it("外接矩形に余白を足した大きさを等倍で返す", () => {
    const geometry = computeExportGeometry({ x: 0, y: 0, width: 400, height: 200 });
    expect(geometry).toEqual({
      width: 400 + EXPORT_PADDING * 2,
      height: 200 + EXPORT_PADDING * 2,
      zoom: 1,
      scaledDown: false,
    });
  });

  it("矩形の位置（x, y）は大きさに影響しない", () => {
    const atOrigin = computeExportGeometry({ x: 0, y: 0, width: 400, height: 200 });
    const farAway = computeExportGeometry({ x: -9000, y: 4200, width: 400, height: 200 });
    expect(farAway).toEqual(atOrigin);
  });

  it("余白は上下左右に入る（片側ぶんではない）", () => {
    const geometry = computeExportGeometry(
      { x: 0, y: 0, width: 100, height: 100 },
      { padding: 25 },
    );
    expect(geometry.width).toBe(150);
    expect(geometry.height).toBe(150);
  });

  it("1 辺の上限を超えると全体を縮小する", () => {
    const geometry = computeExportGeometry(
      { x: 0, y: 0, width: 20_000, height: 1000 },
      { padding: 0, maxDimension: 1000, maxPixels: Number.MAX_SAFE_INTEGER },
    );
    expect(geometry.scaledDown).toBe(true);
    expect(geometry.zoom).toBeCloseTo(0.05, 10);
    expect(geometry.width).toBeLessThanOrEqual(1000);
    expect(geometry.height).toBeLessThanOrEqual(1000);
    // 縮小しても縦横比は保たれる ＝ 切り詰めていない。
    expect(geometry.width / geometry.height).toBeCloseTo(20, 1);
  });

  it("総ピクセル数の上限を超えると全体を縮小する", () => {
    const geometry = computeExportGeometry(
      { x: 0, y: 0, width: 2000, height: 2000 },
      { padding: 0, maxDimension: Number.MAX_SAFE_INTEGER, maxPixels: 1_000_000 },
    );
    expect(geometry.scaledDown).toBe(true);
    expect(geometry.width * geometry.height).toBeLessThanOrEqual(1_000_000);
    expect(geometry.zoom).toBeCloseTo(0.5, 10);
  });

  it("既定の上限は現実的なマップでは発動しない（500 ノード相当）", () => {
    // 500 ノードを深さ 10・幅 50 で並べたときの概算。
    const geometry = computeExportGeometry({ x: 0, y: 0, width: 2440, height: 3000 });
    expect(geometry.zoom).toBe(1);
    expect(geometry.scaledDown).toBe(false);
    expect(geometry.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(geometry.width * geometry.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
  });

  it("巨大なマップでも既定の上限を必ず守る", () => {
    const geometry = computeExportGeometry({ x: 0, y: 0, width: 500_000, height: 300_000 });
    expect(geometry.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(geometry.height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
    expect(geometry.width * geometry.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS);
    expect(geometry.scaledDown).toBe(true);
  });

  it("小さいマップを拡大はしない", () => {
    const geometry = computeExportGeometry({ x: 0, y: 0, width: 10, height: 10 });
    expect(geometry.zoom).toBe(1);
  });

  it("空のマップでも 1px 以上・NaN でない値を返す", () => {
    for (const bounds of [
      { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: Number.NaN, height: Number.NaN },
      { x: 0, y: 0, width: -10, height: -10 },
    ]) {
      const geometry = computeExportGeometry(bounds, { padding: 0 });
      expect(geometry.width).toBeGreaterThanOrEqual(1);
      expect(geometry.height).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(geometry.zoom)).toBe(true);
    }
  });
});

describe("formatScale", () => {
  it("百分率に丸める", () => {
    expect(formatScale(1)).toBe("100%");
    expect(formatScale(0.4242)).toBe("42%");
  });

  it("極端に小さくても 0% とは言わない", () => {
    expect(formatScale(0.0001)).toBe("1%");
  });

  it("壊れた値でも例外を投げない", () => {
    expect(formatScale(Number.NaN)).toBe("0%");
  });
});
