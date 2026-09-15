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
  // 学習ノート。カードが並ぶ。
  cards: (
    <>
      <rect x="4" y="18" width="46" height="58" fill="none" stroke={LINE} />
      <rect x="60" y="18" width="46" height="58" fill="none" stroke={LINE} />
      <rect x="116" y="18" width="34" height="58" fill={ACCENT} opacity="0.16" stroke={ACCENT} />
    </>
  ),
  // キャリア。段を上がっていく。
  ladder: (
    <>
      <g fill="none" stroke={LINE}>
        <path d="M6,84 L40,84 L40,62 L74,62 L74,40 L108,40" />
      </g>
      <rect x="6" y="86" width="34" height="6" fill={FILL} />
      <rect x="40" y="64" width="34" height="6" fill={FILL} />
      <rect x="74" y="42" width="34" height="6" fill={FILL} />
      <rect x="108" y="14" width="44" height="14" fill={ACCENT} opacity="0.65" />
      <path d="M108,40 L130,40 L130,30" fill="none" stroke={LINE} />
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
