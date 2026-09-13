import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdSlot } from "@/features/ads";

/**
 * 広告枠の描画テスト（jsdom）。
 *
 * ここで一番大事なのは **「出してはいけない条件で何も描かれないこと」** の固定。
 * 事業者 ID が未設定なのに空の帯だけが出る状態は、ユーザーから見て不可解で
 * 誠実でもないため、本番では何も描かない。
 *
 * jsdom は実ブラウザではないので、以下はここでは検証できていない:
 * - CSS Module の実際の見え方（高さの確保・枠線・配色）
 * - レイアウトシフトが本当に起きないこと（jsdom はレイアウトを持たない）
 * - ダークモードでのコントラスト
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

/** 広告が1つも描かれていないこと。role でも DOM でも確認する。 */
function expectNothingRendered(container: HTMLElement) {
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.queryByText("広告")).not.toBeInTheDocument();
  expect(container.querySelector("[data-ad-placeholder]")).toBeNull();
  expect(container.querySelector("[data-ad-client]")).toBeNull();
  expect(container).toBeEmptyDOMElement();
}

describe("AdSlot（事業者 ID が未設定）", () => {
  it("本番では何も描かない", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", undefined);

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    expectNothingRendered(container);
  });

  it("ログイン中でも、本番で ID が無ければ何も描かない", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", undefined);

    const { container } = render(<AdSlot slot="settings" signedIn={true} />);

    expectNothingRendered(container);
  });

  it("空文字が入っているだけの設定も未設定として扱う", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", "");

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    expectNothingRendered(container);
  });

  it("開発時以外（テスト実行時など）も何も描かない", () => {
    // 既定の NODE_ENV は "test"。development だけを例外にしている。
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", undefined);

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    expectNothingRendered(container);
  });

  it("開発時だけ、レイアウト確認用の仮表示を出す", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", undefined);

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    const slot = container.querySelector("[data-ad-placeholder]");
    expect(slot).not.toBeNull();
    // 実物と取り違えないよう、仮表示であることが読み取れること。
    expect(
      screen.getByRole("complementary", { name: "広告枠（開発用の仮表示）" }),
    ).toBeInTheDocument();
    // 事業者 ID が無いので、広告本体の受け口は作らない。
    expect(container.querySelector("[data-ad-client]")).toBeNull();
  });
});

describe("AdSlot（事業者 ID が設定済み）", () => {
  it("広告であることが分かる枠を描き、事業者 ID と枠名を受け渡す", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", "ca-pub-test");

    const { container } = render(<AdSlot slot="settings" signedIn={true} />);

    const slot = screen.getByRole("complementary", { name: "広告" });
    expect(slot).toBeInTheDocument();
    // コンテンツに偽装しない。枠の中に「広告」と書いてある。
    expect(slot).toHaveTextContent("広告");
    expect(slot).toHaveAttribute("data-ad-client", "ca-pub-test");
    expect(slot).toHaveAttribute("data-ad-slot", "settings");
    // 仮表示ではない。
    expect(container.querySelector("[data-ad-placeholder]")).toBeNull();
  });

  it("外部スクリプトは読み込まない（事業者登録前に外部送信を始めないこと）", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", "ca-pub-test");

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("キーボード入力を奪うモーダルにはしない", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_AD_CLIENT", "ca-pub-test");

    const { container } = render(<AdSlot slot="map-list" signedIn={false} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.querySelector("[aria-modal]")).toBeNull();
  });
});
