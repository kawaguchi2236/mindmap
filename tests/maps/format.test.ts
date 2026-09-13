import { describe, expect, it } from "vitest";
import {
  describeMapsError,
  describeSyncState,
  formatIndex,
  formatRelativeTime,
} from "@/features/maps/format";
import { IndexedDbUnavailableError, MapNotFoundError } from "@/lib/db";

const NOW = new Date("2026-09-13T12:00:00.000Z");

/** NOW から `ms` だけ過去の ISO 文字列。 */
function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  it("1分未満は「たった今」", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("たった今");
    expect(formatRelativeTime(ago(59_000), NOW)).toBe("たった今");
  });

  it("分・時間・日で丸める", () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe("1分前");
    expect(formatRelativeTime(ago(3 * MINUTE + 40_000), NOW)).toBe("3分前");
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe("1時間前");
    expect(formatRelativeTime(ago(23 * HOUR), NOW)).toBe("23時間前");
    expect(formatRelativeTime(ago(DAY), NOW)).toBe("1日前");
    expect(formatRelativeTime(ago(6 * DAY), NOW)).toBe("6日前");
  });

  it("7日以上前は絶対日付にする", () => {
    // ローカルタイムゾーンに依存しないよう、期待値も同じ Date から組み立てる。
    const old = new Date(NOW.getTime() - 40 * DAY);
    const expected = `${old.getFullYear()}/${old.getMonth() + 1}/${old.getDate()}`;
    expect(formatRelativeTime(old.toISOString(), NOW)).toBe(expected);
  });

  it("端末の時計がずれて未来の日時が来ても「たった今」に丸める", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * HOUR).toISOString(), NOW)).toBe(
      "たった今",
    );
  });

  it("壊れた日時でも例外を投げない", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("日時不明");
  });
});

describe("describeSyncState", () => {
  it("ゲストには同期状態を出さない", () => {
    expect(describeSyncState("local-only", false)).toBeNull();
    expect(describeSyncState("failed", false)).toBeNull();
  });

  it("ログイン中は状態を出し、失敗だけ警告色にする", () => {
    expect(describeSyncState("synced", true)).toEqual({ label: "同期済み", tone: "normal" });
    expect(describeSyncState("pending", true)).toEqual({ label: "同期待ち", tone: "normal" });
    expect(describeSyncState("local-only", true)).toEqual({
      label: "この端末のみ",
      tone: "normal",
    });
    expect(describeSyncState("failed", true)).toEqual({
      label: "同期できません",
      tone: "danger",
    });
  });
});

describe("formatIndex", () => {
  it("2桁に揃える", () => {
    expect(formatIndex(0)).toBe("01");
    expect(formatIndex(9)).toBe("10");
    expect(formatIndex(99)).toBe("100");
  });
});

describe("describeMapsError", () => {
  it("IndexedDB が使えないことを具体的に伝える", () => {
    const message = describeMapsError(new IndexedDbUnavailableError(), "load");
    expect(message).toContain("マップ一覧を読み込めませんでした");
    expect(message).toContain("ローカルに保存できません");
  });

  it("操作ごとに冒頭の文が変わる", () => {
    expect(describeMapsError(new MapNotFoundError("m1"), "rename")).toContain(
      "マップの名前を変更できませんでした",
    );
    expect(describeMapsError(new MapNotFoundError("m1"), "delete")).toContain(
      "マップを削除できませんでした",
    );
  });

  it("未知のエラーでも生のメッセージやスタックを漏らさない", () => {
    const raw = "TypeError: Cannot read properties of undefined (reading 'foo')";
    const message = describeMapsError(new Error(raw), "load");
    expect(message).not.toContain(raw);
    expect(message).toContain("しばらくしてからもう一度お試しください");
  });
});
