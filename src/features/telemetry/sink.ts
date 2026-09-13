/**
 * 送信の口（CLAUDE.md §31 / §19 / §29）。
 *
 * 事業者の SDK（PostHog / Sentry / GA など）はまだ入れない。どれもアカウントと
 * API キーが要り、どこへ送るかは利用者側の判断だから。ここが用意するのは
 * **送信先 URL を環境変数から受け取って JSON を1回 POST するだけの口**で、
 * 事業者を選んだあとは、その口に差すか、この1ファイルを差し替えれば済む。
 * 将来のための抽象化（プロバイダ登録・キュー・リトライ）はここに作らない（§37）。
 *
 * 守っていること:
 * - 送信先が未設定なら**本番では何もしない**。開発時だけ console.debug で流れを出す。
 * - **失敗してもアプリに一切影響させない**。例外を投げず、呼び出し側を待たせない。
 */

/**
 * イベントの送信先。未設定なら null。
 *
 * NEXT_PUBLIC_ 付きの参照はビルド時に静的置換されるため、変数に畳まないこと。
 */
function analyticsEndpoint(): string | null {
  const value = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  return value !== undefined && value.length > 0 ? value : null;
}

/**
 * エラーの送信先。イベントと分けてあるのは、計測とエラー監視は別の事業者になるのが
 * 普通で（例: 計測は PostHog、エラーは Sentry）、片方だけ有効にしたいことがあるため。
 */
function errorEndpoint(): string | null {
  const value = process.env.NEXT_PUBLIC_ERROR_ENDPOINT;
  return value !== undefined && value.length > 0 ? value : null;
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

/**
 * JSON を1回だけ送る。**返り値は無い（await させない）。例外も投げない。**
 *
 * sendBeacon を優先するのは、タブを閉じる途中でも送り切れるため。
 * 使えない／拒否された場合だけ fetch にする。どちらも失敗は握りつぶす:
 * 計測の失敗はユーザーの作業に何の関係も無い（§29 の「同期が落ちても編集は続く」と同じ考え）。
 */
function post(url: string, body: unknown): void {
  let payload: string;
  try {
    payload = JSON.stringify(body);
  } catch {
    return;
  }

  try {
    const beacon = globalThis.navigator?.sendBeacon;
    if (typeof beacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      if (beacon.call(globalThis.navigator, url, blob)) return;
    }
  } catch {
    // sendBeacon が投げた場合は fetch にフォールバックする。
  }

  try {
    void globalThis
      .fetch(url, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        // 計測のために Cookie を送る必要は無い（§30: 集める個人情報は最小限に）。
        credentials: "omit",
      })
      .catch(() => {
        // ネットワーク断・CORS・503。いずれもアプリの動作には影響させない。
      });
  } catch {
    // fetch 自体が無い環境（古いランタイム）。何もしない。
  }
}

/** イベントを送る。送信先が未設定なら本番では何もしない。 */
export function sendEvent(envelope: unknown): void {
  const url = analyticsEndpoint();
  if (url === null) {
    if (isDevelopment()) console.debug("[telemetry] event", envelope);
    return;
  }
  post(url, envelope);
}

/** エラーを送る。送信先が未設定なら本番では何もしない。 */
export function sendError(report: unknown): void {
  const url = errorEndpoint();
  if (url === null) {
    if (isDevelopment()) console.debug("[telemetry] error", report);
    return;
  }
  post(url, report);
}
