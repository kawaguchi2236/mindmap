/**
 * 画像化の前に、SVG の中身へ「塗り・線」の指定をインラインで焼き込む。
 *
 * なぜ必要か（html-to-image / React Flow の実装を読んだ結果。推測ではない）:
 *
 * 1. React Flow のエッジは `<svg><g class="react-flow__edge"><path
 *    class="react-flow__edge-path" fill="none" d="…">` という構造で、
 *    **線の色と太さは CSS だけ**から来る
 *    （`@xyflow/react/dist/style.css` の
 *     `.react-flow__edge-path { stroke: var(--xy-edge-stroke, …); … }` と
 *     `editor.css` の `.mindmap-canvas .react-flow__edge-path { stroke: … }`）。
 *    path 自身が持つのは `d` と `fill="none"` だけ。
 *
 * 2. html-to-image は要素を複製し、**計算済みスタイルを1要素ずつ style 属性へ
 *    書き写す**ことで見た目を再現する。ところが `clone-node.js` の
 *    `cloneChildren` は複製先が `<svg>` だと即 return する:
 *
 *    ```js
 *    if (isSVGElement(clonedNode)) { return clonedNode; }
 *    ```
 *
 *    `<svg>` は `cloneNode(true)` で丸ごと複製されるが、**その子孫は
 *    decorate されない＝インラインスタイルが一切付かない。**
 *
 * 3. 複製されたツリーは `<svg><foreignObject>` に入れて data URL 化され、
 *    `<img>` として読み込まれる。この文書には**ページの CSS が無い**。
 *
 * 結果、`stroke` は CSS からしか来ないので失われ、SVG の初期値
 * `stroke: none` に戻る。`fill` は属性の `none` が残る。
 * **塗りも線も無い ＝ 線が1本も写らない。** ノード（HTML の div）は
 * 1要素ずつ decorate されるので完璧に写る、という観測と一致する。
 *
 * 対策として、書き出しの直前に計算済みの値を本物の DOM へ書き込み、
 * 書き出しが終わったら **必ず元に戻す**。書き込む値は計算済みの値そのものなので
 * 画面の見た目は変わらない。
 */

/**
 * SVG の見た目を決めるプロパティのうち、CSS からしか来ない可能性があるもの。
 * 位置や形（`d`・`transform`・座標）は属性なので複製時にそのまま残る。
 */
const SVG_PAINT_PROPERTIES = [
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "opacity",
  "marker-start",
  "marker-mid",
  "marker-end",
  "color",
  "visibility",
] as const;

/** 元の style 属性（無かった場合は null）を覚えておくための組。 */
type SavedStyle = [SVGElement, string | null];

/**
 * `root` の中にあるすべての `<svg>` の**子孫**へ、計算済みの塗り・線を書き込む。
 *
 * @returns 元の状態へ戻す関数。**必ず finally で呼ぶこと。**
 */
export function inlineSvgPaintStyles(root: ParentNode | null): () => void {
  if (root === null || typeof window === "undefined") return () => {};

  // `<svg>` 自身は html-to-image が decorate してくれる。問題は子孫だけ。
  const targets = root.querySelectorAll<SVGElement>("svg *");
  const saved: SavedStyle[] = [];

  for (const element of targets) {
    // style プロパティを持たない要素（<desc> 等の一部）は触らない。
    if (!(element.style instanceof CSSStyleDeclaration)) continue;
    saved.push([element, element.getAttribute("style")]);

    const computed = window.getComputedStyle(element);
    for (const property of SVG_PAINT_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value === "") continue;
      element.style.setProperty(property, value);
    }
  }

  return () => {
    for (const [element, style] of saved) {
      if (style === null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
  };
}
