/**
 * PNG 書き出しの本体（task.md §13 / CLAUDE.md §16）。
 *
 * 画像化の対象は React Flow の `.react-flow__viewport`。この要素は
 * 「ノードとエッジだけが乗っていて、パン・ズームが transform で表現される」
 * ため、transform を差し替えるだけで任意の範囲を切り出せる。
 *
 * 重要なのは **現在の表示状態を一切使わないこと**。出力の transform は
 * ノードの外接矩形からだけ計算する（§16「表示中のビューポートではなく全体」）。
 *
 * 失敗しても例外を投げない。エディタの編集を止めないことが最優先で、
 * 呼び出し側は結果オブジェクトを見て再試行させる（CLAUDE.md §29）。
 */
import { getViewportForBounds } from "@xyflow/react";
import { toPng } from "html-to-image";
import { resolveBackgroundColor } from "./background";
import { toPngFileName } from "./filename";
import { computeExportGeometry, type ExportGeometryOptions, type Rect } from "./geometry";

/** html-to-image の `toPng` と同じ形。テストで差し替えるために切り出している。 */
export type RenderToPng = (
  element: HTMLElement,
  options: {
    backgroundColor: string;
    width: number;
    height: number;
    pixelRatio: number;
    style: Partial<CSSStyleDeclaration>;
  },
) => Promise<string>;

/** 生成した data URL を保存する。既定は `<a download>` のクリック。 */
export type SavePng = (dataUrl: string, fileName: string) => void;

export interface ExportMapToPngParams {
  /** 画像化する要素。`.react-flow__viewport` を渡す。 */
  viewport: HTMLElement | null;
  /**
   * 書き出す範囲（キャンバス座標）。React Flow インスタンスの
   * `getNodesBounds(getNodes())` の結果をそのまま渡す。
   * `getNodes()` は表示中のノードだけを返すので、折りたたまれた子孫は入らない
   * （= 見たままが出る。docs/adr/ADR-006-png-export.md）。
   */
  bounds: Rect;
  /** ファイル名のもとになるマップのタイトル。 */
  title: string | null | undefined;
  /** 背景色。省略時は `viewport` の祖先から実際の描画色を拾う。 */
  backgroundColor?: string;
  /** 余白と出力サイズ上限。省略時は geometry.ts の既定値。 */
  limits?: ExportGeometryOptions;
  /** テスト用の差し替え口。 */
  render?: RenderToPng;
  /** テスト用の差し替え口。 */
  save?: SavePng;
}

export type ExportResult =
  | {
      ok: true;
      fileName: string;
      /** 1 未満なら上限に当たって縮小している。ユーザーに伝えること。 */
      scale: number;
      width: number;
      height: number;
    }
  | { ok: false; message: string };

const GENERIC_FAILURE = "PNG の書き出しに失敗しました。もう一度お試しください。";

/**
 * ボタンなどの要素から、同じ React Flow のビューポート要素を探す。
 * `document` 全体から引かないのは、将来キャンバスが複数になっても
 * 自分が属する方を選ぶため。
 */
export function findViewportElement(from: Element | null | undefined): HTMLElement | null {
  const container = from?.closest(".react-flow");
  return container?.querySelector<HTMLElement>(".react-flow__viewport") ?? null;
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

/** マップ全体を PNG にして保存する。例外は外に出さない。 */
export async function exportMapToPng(params: ExportMapToPngParams): Promise<ExportResult> {
  const { viewport, bounds, title, limits, render = toPng, save = downloadDataUrl } = params;

  try {
    if (viewport === null) {
      return { ok: false, message: "キャンバスが見つかりませんでした。画面を開き直してください。" };
    }
    if (!(bounds.width > 0) || !(bounds.height > 0)) {
      return { ok: false, message: "書き出せるノードがありません。" };
    }

    const geometry = computeExportGeometry(bounds, limits);

    /*
     * 出力用の transform。外接矩形を出力サイズの中央に収める。
     * min/max を同じ値にして倍率を固定し、余白は geometry 側で確保済みなので
     * ここでの padding は 0 にする（渡すと中央寄せに余計な補正が入る）。
     */
    const { x, y, zoom } = getViewportForBounds(
      bounds,
      geometry.width,
      geometry.height,
      geometry.zoom,
      geometry.zoom,
      0,
    );

    const dataUrl = await render(viewport, {
      backgroundColor: params.backgroundColor ?? resolveBackgroundColor(viewport),
      width: geometry.width,
      height: geometry.height,
      // 端末の DPR に結果を左右させない。上限の計算と実際の出力を一致させる。
      pixelRatio: 1,
      style: {
        width: `${geometry.width}px`,
        height: `${geometry.height}px`,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: "0 0",
      },
    });

    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/png")) {
      return { ok: false, message: GENERIC_FAILURE };
    }

    const fileName = toPngFileName(title);
    save(dataUrl, fileName);
    return {
      ok: true,
      fileName,
      scale: geometry.zoom,
      width: geometry.width,
      height: geometry.height,
    };
  } catch (error) {
    // 生のスタックはユーザーに見せない。診断用にコンソールだけへ残す。
    console.error("PNG 書き出しに失敗しました", error);
    return { ok: false, message: GENERIC_FAILURE };
  }
}
