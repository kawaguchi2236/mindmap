"use client";

/**
 * 計測とエラー監視を起動する。何も描画しない。
 *
 * アプリの一番外側（`src/app/layout.tsx` の <body> 直下）に1つだけ置く。
 * ここでやるのは `app_started` を1回出すことと、拾い損ねた例外を拾う登録だけ。
 */

import { useEffect } from "react";
import { installGlobalErrorHandlers } from "./errors";
import { track } from "./track";

/**
 * `app_started` を送ったか。
 *
 * モジュール変数にしているのは、開発時の StrictMode で effect が2回走っても
 * 2件出さないため（§31: 出すのは意味のあるイベントだけ）。
 */
let appStarted = false;

export function TelemetryBootstrap() {
  useEffect(() => {
    const uninstall = installGlobalErrorHandlers();
    if (!appStarted) {
      appStarted = true;
      track("app_started");
    }
    return uninstall;
  }, []);

  return null;
}
