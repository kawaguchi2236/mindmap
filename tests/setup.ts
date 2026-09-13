import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

/**
 * jsdom に無いブラウザ API の最小スタブ。UI テストを書く担当はここを共有して使う。
 *
 * ここにあるのは「jsdom が実装していないから落ちる」を防ぐためだけのもので、
 * 本物の挙動ではない。**これらに依存する挙動（モーダルのフォーカストラップ、
 * Esc で閉じる、テーマの OS 追従など）は jsdom では検証できていない**ので、
 * 実ブラウザで確認すること。
 */
const globals = globalThis as unknown as Record<string, unknown>;

/** React Flow（キャンバス）が前提にしている。 */
globals.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

globals.DOMMatrixReadOnly ??= class {
  m22 = 1;
  constructor(_transform?: string) {}
};

/** ThemeProvider が OS のテーマ設定を読むのに使う。 */
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * jsdom 29 は <dialog> の showModal / close を実装していない。
 * open 属性の付け外しだけを再現する。
 * トップレイヤー・フォーカストラップ・Esc は再現しない（実機で確認すること）。
 */
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    show?: () => void;
    close?: (returnValue?: string) => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.show !== "function") {
    proto.show = function show(this: HTMLDialogElement) {
      this.open = true;
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement, returnValue?: string) {
      this.open = false;
      if (returnValue !== undefined) this.returnValue = returnValue;
      this.dispatchEvent(new Event("close"));
    };
  }
}
