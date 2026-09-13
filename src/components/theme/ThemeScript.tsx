import { THEME_STORAGE_KEY } from "./types";

/**
 * 最初の描画より前に `data-theme` を確定させるための同期スクリプト。
 *
 * これが無いと、SSR された HTML（テーマ未指定＝OS 設定）が一瞬表示されてから
 * ThemeProvider の effect で切り替わり、明示ライト／ダークを選んでいる人に
 * 画面のちらつきが見える。`<head>` 内に置いて同期実行させる。
 *
 * `system` のときは属性を付けない。globals.css の
 * `@media (prefers-color-scheme: dark)` にそのまま任せるため。
 */
export function ThemeScript() {
  const script = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )});if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

  return (
    <script
      // 内容は上のリテラルだけで、外部入力は混ざらない。
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
