import { describe, expect, it } from "vitest";
import { track } from "@/features/telemetry/track";

/**
 * 型レベルの検証（CLAUDE.md §31）。
 *
 * このファイルの本体は `npx tsc --noEmit` で効く。`@ts-expect-error` が付いた行が
 * **実際にコンパイルエラーにならなくなったら tsc が落ちる**ので、
 * 「利用者が書いた内容をペイロードに入れられない」という性質が壊れたら気付ける。
 *
 * 実行はしない（送信させないため）。呼ばない関数の中に置いてある。
 */
function _compileTimeChecks() {
  // 許されるもの: 数と真偽値と、決められたリテラルだけ。
  track("app_started");
  track("map_opened", { nodeCount: 3 });
  track("png_exported", { nodeCount: 3, scaled: false });
  track("sync_failed", { reason: "offline" });
  track("login_completed", { method: "google" });

  // @ts-expect-error ノード本文を足せない（このイベントはペイロードを取らない）
  track("node_created", { text: "利用者が書いたノード本文" });

  // @ts-expect-error 決められたフィールド以外を足せない
  track("map_opened", { nodeCount: 3, title: "マップのタイトル" });

  // @ts-expect-error 自由な文字列を理由にできない
  track("sync_failed", { reason: "利用者が書いたノード本文" });

  // @ts-expect-error メールアドレスをログイン方法にできない
  track("login_completed", { method: "kawaguchi2236@example.test" });

  // @ts-expect-error §31 に無いイベントは足せない
  track("map_title_changed");
}

describe("イベントのペイロード", () => {
  it("型チェックは tsc が行う（ここでは実行しない）", () => {
    expect(typeof _compileTimeChecks).toBe("function");
  });
});
