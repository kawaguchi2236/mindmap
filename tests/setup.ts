import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

/**
 * jsdom に無いブラウザ API の最小スタブ。
 * React Flow（キャンバス）は ResizeObserver と DOMMatrixReadOnly を前提にしている。
 * UI テストを書く担当はここを共有して使うこと。
 */
const globals = globalThis as unknown as Record<string, unknown>;

globals.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

globals.DOMMatrixReadOnly ??= class {
  m22 = 1;
  constructor(_transform?: string) {}
};
