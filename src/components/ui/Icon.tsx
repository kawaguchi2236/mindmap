import type { SVGProps } from "react";

/**
 * アプリで使うアイコンはここに列挙したものだけ。
 * 増やすときは本当に必要か（既存で代用できないか）を確認してから足す。
 */
export type IconName =
  | "plus"
  | "minus"
  | "trash"
  | "search"
  | "chevron-right"
  | "chevron-down"
  | "sun"
  | "moon"
  | "download"
  | "settings"
  | "recenter"
  | "close"
  | "check"
  | "menu"
  | "text"
  | "collapse";

/**
 * 24×24 のビューボックスに線画で描く。塗りは使わず currentColor のストロークだけ。
 * こうすると文字色に自然に馴染み、ダークモードでも追加の指定が要らない。
 */
const PATHS: Record<IconName, React.ReactNode> = {
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10 11v5.5" />
      <path d="M14 11v5.5" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M15.8 15.8L20.5 20.5" />
    </>
  ),
  "chevron-right": <path d="M9.5 5l7 7-7 7" />,
  "chevron-down": <path d="M5 9.5l7 7 7-7" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5" />
      <path d="M12 19v2.5" />
      <path d="M2.5 12H5" />
      <path d="M19 12h2.5" />
      <path d="M5.2 5.2l1.8 1.8" />
      <path d="M17 17l1.8 1.8" />
      <path d="M18.8 5.2L17 7" />
      <path d="M7 17l-1.8 1.8" />
    </>
  ),
  moon: <path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.6 8.6 0 1 0 11.3 11.3z" />,
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19.5h14" />
    </>
  ),
  // スライダー型。歯車より線が少なく、小さいサイズでも潰れない。
  settings: (
    <>
      <path d="M4 8h9.5" />
      <path d="M18.5 8H20" />
      <circle cx="16" cy="8" r="2.5" />
      <path d="M4 16h3.5" />
      <path d="M12.5 16H20" />
      <circle cx="10" cy="16" r="2.5" />
    </>
  ),
  // 照準。キャンバスを中央に戻す操作に使う。
  recenter: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5L19.5 7" />,
  menu: (
    <>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </>
  ),
  /* Aa。ノードのテキストを編集する操作に使う（ハンドオフの `text-aa`）。 */
  text: (
    <>
      <path d="M3 18L8 6l5 12" />
      <path d="M4.6 14h6.8" />
      <path d="M20.5 12.5a3 3 0 1 0-6 0v2a3 3 0 1 0 6 0z" />
      <path d="M20.5 10v8" />
    </>
  ),
  /* 二重の山括弧。部分木を折りたたむ操作に使う（ハンドオフの `caret-double-left`）。 */
  collapse: (
    <>
      <path d="M12.5 6l-6 6 6 6" />
      <path d="M19 6l-6 6 6 6" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  /** 正方形の一辺（px）。ハンドオフの標準は 14–19px。 */
  size?: number;
  /**
   * 読み上げに載せたいときだけ渡す。
   * 省略すると `aria-hidden` の装飾アイコンになる（ラベルはボタン側で持つこと）。
   */
  title?: string;
}

export function Icon({ name, size = 16, title, ...rest }: IconProps) {
  const decorative = title === undefined;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      focusable="false"
      {...rest}
    >
      {!decorative && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
