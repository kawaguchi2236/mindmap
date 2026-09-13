/**
 * イベントを発火する側の入口（CLAUDE.md §31）。
 *
 * 呼び出し側はここだけを使う。送信先が有効かどうか、どう送るかは知らなくてよい。
 */

import type { TelemetryEnvelope, TelemetryEventName, TrackArgs } from "./events";
import { sendEvent } from "./sink";

/**
 * `map_edited` を間引く間隔。
 *
 * §31 が「打鍵ごとにイベントを出すな」と明示している。編集は連続で起きるので、
 * 呼び出し側の規律に任せず**ここで必ず間引く**。知りたいのは「そのセッションで
 * 編集したか」であって編集回数ではないため、1分に1件あれば十分。
 */
export const MAP_EDITED_THROTTLE_MS = 60_000;

/** 直近で `map_edited` を送った時刻（epoch ms）。まだ送っていなければ null。 */
let lastMapEditedAt: number | null = null;

/**
 * イベントを1件送る。
 *
 * **例外を投げない。await もさせない。** 計測が原因でユーザーの操作が止まることは無い。
 *
 * 渡せるペイロードは `TelemetryEventMap` が許した数値・真偽値・固定リテラルだけ。
 * ノード本文のような自由な文字列は型で弾かれる（events.ts 参照）。
 */
export function track<K extends TelemetryEventName>(...args: TrackArgs<K>): void {
  const [name, properties] = args as [TelemetryEventName, Record<string, unknown> | undefined];
  try {
    const envelope: TelemetryEnvelope = {
      name,
      properties: (properties ?? {}) as TelemetryEnvelope["properties"],
      at: Date.now(),
    };
    sendEvent(envelope);
  } catch {
    // 計測は落ちてよい。呼び出し元には何も伝えない。
  }
}

/**
 * 編集が起きたことを記録する。**エディタはこれを打鍵ごとに呼んでよい。**
 * 実際に送られるのは `MAP_EDITED_THROTTLE_MS` に最大1件。
 *
 * 最初の1件はすぐ送る（leading edge）。短い編集で終わったセッションを
 * 取りこぼさないため。
 */
export function trackMapEdited(): void {
  const now = Date.now();
  if (lastMapEditedAt !== null && now - lastMapEditedAt < MAP_EDITED_THROTTLE_MS) return;
  lastMapEditedAt = now;
  track("map_edited");
}
