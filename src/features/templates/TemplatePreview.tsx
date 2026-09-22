/**
 * テンプレートのプレビュー（design/ハンドオフ.md `#3c`）。
 *
 * 枠なしの 120px の領域に線画だけを置く。実際のマップの縮小図ではなく、
 * 「どんな形に整理するか」を示す記号。色はトークンで指定するので
 * ダークモードでもそのまま成立する。
 */
import type { ReactElement } from "react";
import type { TemplatePreviewKind } from "./catalog";
import styles from "./TemplateScreen.module.css";

const LINE = "var(--color-text-disabled)";
const FILL = "var(--color-text-disabled)";
const ACCENT = "var(--color-accent)";

const SHAPES: Record<TemplatePreviewKind, ReactElement> = {
  // SWOT。4分割のうち1つだけがアクセント。
  quadrants: (
    <>
      <g fill="none" stroke={LINE}>
        <rect x="2" y="8" width="72" height="36" />
        <rect x="82" y="8" width="72" height="36" />
        <rect x="2" y="52" width="72" height="36" />
      </g>
      <rect x="82" y="52" width="72" height="36" fill={ACCENT} opacity="0.16" stroke={ACCENT} />
    </>
  ),
  // ロードマップ。時間軸に節が並ぶ。
  timeline: (
    <>
      <line x1="4" y1="48" x2="160" y2="48" stroke={LINE} />
      <circle cx="28" cy="48" r="6" fill={ACCENT} />
      <circle cx="80" cy="48" r="6" fill={FILL} />
      <circle cx="132" cy="48" r="6" fill={FILL} />
      <rect x="16" y="20" width="26" height="7" fill={FILL} />
      <rect x="68" y="66" width="26" height="7" fill={FILL} />
      <rect x="120" y="20" width="26" height="7" fill={FILL} />
    </>
  ),
  // WBS。1つの親から複数へ分解する。
  breakdown: (
    <>
      <g fill="none" stroke={LINE}>
        <path d="M46,48 C70,48 70,20 96,20" />
        <path d="M46,48 L96,48" />
        <path d="M46,48 C70,48 70,76 96,76" />
      </g>
      <rect x="8" y="41" width="36" height="14" fill={ACCENT} />
      <rect x="98" y="14" width="52" height="11" fill={FILL} />
      <rect x="98" y="42" width="52" height="11" fill={FILL} />
      <rect x="98" y="70" width="52" height="11" fill={FILL} />
    </>
  ),
  /*
   * ロジックツリー。1つの論点が2段で分かれていく。
   * WBS（breakdown）とは線の引き方で描き分ける：あちらは曲線、こちらは直角。
   * 論理の分解は「どこで枝が分かれたか」が読めることが大事なので、
   * 縦の幹と横の枝だけで描く。
   */
  tree: (
    <>
      <g fill="none" stroke={LINE}>
        <path d="M32,48 H46 M46,24 V72 M46,24 H50 M46,72 H50" />
        <path d="M90,24 H100 M100,10 V38 M100,10 H110 M100,38 H110" />
        <path d="M90,72 H100 M100,58 V86 M100,58 H110 M100,86 H110" />
      </g>
      <rect x="2" y="41" width="30" height="14" fill={ACCENT} />
      <rect x="50" y="19" width="40" height="10" fill={FILL} />
      <rect x="50" y="67" width="40" height="10" fill={FILL} />
      <rect x="110" y="6" width="44" height="8" fill={FILL} />
      <rect x="110" y="34" width="44" height="8" fill={FILL} />
      <rect x="110" y="54" width="44" height="8" fill={FILL} />
      <rect x="110" y="82" width="44" height="8" fill={FILL} />
    </>
  ),
  // OKR。1つの目標の下に指標が積まれる。
  stack: (
    <>
      <rect x="4" y="14" width="150" height="14" fill={ACCENT} opacity="0.65" />
      <rect x="4" y="40" width="104" height="11" fill={FILL} />
      <rect x="4" y="60" width="124" height="11" fill={FILL} />
      <rect x="4" y="80" width="84" height="11" fill={FILL} />
    </>
  ),
  // ブレスト。中心から放射する。
  radial: (
    <>
      <g fill="none" stroke={LINE}>
        <path d="M84,48 L44,20" />
        <path d="M84,48 L124,20" />
        <path d="M84,48 L44,76" />
        <path d="M84,48 L124,76" />
      </g>
      <circle cx="84" cy="48" r="10" fill={ACCENT} />
      <circle cx="44" cy="20" r="6" fill={FILL} />
      <circle cx="124" cy="20" r="6" fill={FILL} />
      <circle cx="44" cy="76" r="6" fill={FILL} />
      <circle cx="124" cy="76" r="6" fill={FILL} />
    </>
  ),
  // 読書メモ。左に本、右に書き出し。
  columns: (
    <>
      <rect x="4" y="14" width="58" height="66" fill="none" stroke={LINE} />
      <rect x="14" y="26" width="38" height="8" fill={FILL} />
      <rect x="14" y="40" width="38" height="8" fill={FILL} />
      <rect x="78" y="26" width="72" height="12" fill={ACCENT} opacity="0.65" />
      <rect x="78" y="46" width="56" height="9" fill={FILL} />
      <rect x="78" y="62" width="64" height="9" fill={FILL} />
    </>
  ),
  /*
   * 学習ノート。コーネル式の3領域（左のキーワード欄・右のノート欄・下のサマリー欄）。
   * サマリーだけアクセントにしているのは、最後に自分の言葉で埋める箱だから。
   */
  cornell: (
    <>
      <g fill="none" stroke={LINE}>
        <rect x="8" y="8" width="38" height="58" />
        <rect x="50" y="8" width="104" height="58" />
      </g>
      <g fill={FILL}>
        <rect x="16" y="18" width="22" height="6" />
        <rect x="16" y="32" width="18" height="6" />
        <rect x="58" y="18" width="70" height="6" />
        <rect x="58" y="32" width="84" height="6" />
        <rect x="58" y="46" width="60" height="6" />
      </g>
      <rect x="8" y="72" width="146" height="16" fill={ACCENT} opacity="0.16" stroke={ACCENT} />
    </>
  ),
  /*
   * キャリア棚卸し。Will / Can / Must の3つの輪。
   * 重なりにアクセントを置いて「次の一歩はここ」を示す。
   */
  venn: (
    <>
      <g fill="none" stroke={LINE}>
        <circle cx="62" cy="36" r="24" />
        <circle cx="108" cy="36" r="24" />
        <circle cx="85" cy="64" r="24" />
      </g>
      <circle cx="85" cy="47" r="7" fill={ACCENT} />
    </>
  ),
  // 空のマップ。破線の枠とプラス。
  blank: (
    <>
      <rect x="4" y="14" width="150" height="68" fill="none" stroke={LINE} strokeDasharray="5 5" />
      <line x1="72" y1="48" x2="86" y2="48" stroke={ACCENT} />
      <line x1="79" y1="41" x2="79" y2="55" stroke={ACCENT} />
    </>
  ),
};

export function TemplatePreview({ kind }: { kind: TemplatePreviewKind }): ReactElement {
  return (
    <svg className={styles.previewArt} width="170" height="96" aria-hidden="true">
      {SHAPES[kind]}
    </svg>
  );
}
