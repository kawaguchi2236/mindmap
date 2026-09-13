import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope, Source_Serif_4 } from "next/font/google";
import { ThemeProvider, ThemeScript } from "@/components/theme";
import { AuthSessionProvider } from "@/features/auth/SessionProvider";
import { TelemetryBootstrap } from "@/features/telemetry";
import "./globals.css";

/* 欧文のみ Web フォントで読み込み、和文は端末のシステムフォントに任せる。
   フォントのフォールバックはグリフ単位で効くので、この組み合わせで
   「欧文は Broadsheet の書体・和文はシステムの明朝／ゴシック」になる。
   和文 Web フォントは数 MB になり初期表示 3 秒の目標（CLAUDE.md §10）と
   合わないため、Phase 1 では読み込まない。実際のスタックは
   globals.css の --font-ui / --font-display / --font-mono を参照。 */

const ui = Manrope({
  variable: "--font-ui-latin",
  subsets: ["latin"],
  display: "swap",
});

const display = Source_Serif_4({
  variable: "--font-display-latin",
  subsets: ["latin"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono-latin",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Web MindMap",
  description:
    "思考を止めずに書き出すためのマインドマップ。キーボード中心の操作、自動保存、オフラインでも使えます。",
};

export const viewport: Viewport = {
  // ライト／ダークどちらのブラウザ UI にも馴染ませる
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1918" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // ThemeScript が描画前に data-theme を付けるので、
    // サーバーが返した HTML とは属性が食い違う。suppressHydrationWarning が必要。
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${ui.variable} ${display.variable} ${mono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body>
        {/* 何も描画しない。app_started の送出と、window.onerror /
            unhandledrejection のグローバル捕捉をここで仕掛ける。
            これが無いとエラー監視が一切働かない。 */}
        <TelemetryBootstrap />
        {/* セッションはクライアント側で取る。ここでサーバーのセッションを
            読むとアプリ全体が動的レンダリングに落ち、エディタを開くたびに
            Worker で認証が走る（ADR-001 の CPU 予算）。 */}
        <AuthSessionProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
