import { describe, expect, it } from "vitest";
import { shouldShowAds } from "@/features/ads";

/**
 * Free / Pro 判定（CLAUDE.md §15）。
 *
 * Phase 1 に課金は無く、ゲストもログイン中のユーザーも全員 Free。
 * ここで固定したいのは「ログインしても広告は消えない」という現在の仕様で、
 * うっかり出し分けを足したら落ちるようにしてある。
 */
describe("shouldShowAds", () => {
  it("ゲスト（未ログイン）には広告を出す", () => {
    expect(shouldShowAds(false)).toBe(true);
  });

  it("ログイン中の Free ユーザーにも広告を出す", () => {
    // Phase 1 は「ログインすると広告が消える」約束をしていない。
    expect(shouldShowAds(true)).toBe(true);
  });
});
