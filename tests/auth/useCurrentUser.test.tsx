import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "@/features/auth/SessionProvider";
import { useCurrentUser } from "@/features/auth/useCurrentUser";

/**
 * クライアント側のセッション取得口のテスト。
 *
 * ここが守るのは「**ゲストで壊れないこと**」の一点。ログインは Phase 1 でも
 * 任意で、認証基盤が無い・壊れている環境でもアプリは動き続けなければならない
 * （CLAUDE.md §14 / §29）。したがって見るのは:
 *
 *   - `<AuthSessionProvider>` が無くても例外を投げずにゲストになる
 *   - `/api/auth/session` が失敗しても（AUTH_SECRET 未設定など）ゲストになる
 *   - ログイン中はサーバ側の `getCurrentUser()` と同じ形を返す
 *
 * 実ブラウザでの本物のログインは検証していない（Google も Resend も未接続）。
 */

/** フックの戻り値をそのまま DOM に出すだけの部品。 */
function Probe() {
  const { user, loading } = useCurrentUser();
  return (
    <>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user === null ? "guest" : JSON.stringify(user)}</span>
    </>
  );
}

type FetchStub = ReturnType<typeof vi.fn>;

function stubFetch(impl: () => Promise<unknown>): FetchStub {
  const stub = vi.fn(impl);
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

/** 200 でセッション本体を返す（ログイン中）。 */
function respondWith(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

/**
 * AUTH_SECRET 未設定のサーバが返すもの。Auth.js は設定エラーを 500 で返し、
 * next-auth のクライアントはそれを失敗として扱う。
 */
function respondWithServerError(): Promise<Response> {
  return Promise.resolve({
    ok: false,
    json: () => Promise.resolve({ message: "There is a problem with the server configuration." }),
  } as Response);
}

const SIGNED_IN = {
  user: { id: "u1", email: "a@example.com", name: "あや" },
  expires: "2999-01-01T00:00:00.000Z",
};

/** マウント直後の非同期処理を流し切る。 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** タブを離れて戻ってくる（next-auth が再取得のきっかけにしているイベント）。 */
async function switchAwayAndBack(): Promise<void> {
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
  await settle();
}

function shownUser(): string {
  return screen.getByTestId("user").textContent ?? "";
}

function shownLoading(): string {
  return screen.getByTestId("loading").textContent ?? "";
}

const realFetch = globalThis.fetch;

beforeEach(() => {
  // next-auth は取得失敗を console.error に出す。テストの出力を汚さないよう黙らせる。
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Provider が無くても壊れない", () => {
  it("ゲストとして null を返し、例外も通信も起きない", async () => {
    const fetchStub = stubFetch(() => respondWith(SIGNED_IN));

    // `useSession()` は Provider の外で呼ぶと開発時に throw する。ここは throw しない。
    expect(() => render(<Probe />)).not.toThrow();
    await settle();

    expect(shownUser()).toBe("guest");
    // 取得しにいってすらいないので「読み込み中」でもない。
    expect(shownLoading()).toBe("false");
    expect(fetchStub).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("セッションの取得に失敗しても止まらない", () => {
  it("AUTH_SECRET 未設定相当（500）ならゲストに落ちる", async () => {
    stubFetch(respondWithServerError);

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(shownUser()).toBe("guest");
    // 失敗したまま「読み込み中」で固まらない。ゲストとして確定させる。
    expect(shownLoading()).toBe("false");
  });

  it("通信そのものが失敗してもゲストに落ちる", async () => {
    stubFetch(() => Promise.reject(new Error("Failed to fetch")));

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(shownUser()).toBe("guest");
    expect(shownLoading()).toBe("false");
  });

  it("失敗を延々と叩き直さない（タブを切り替えても増えない）", async () => {
    const fetchStub = stubFetch(respondWithServerError);

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();
    const afterMount = fetchStub.mock.calls.length;

    await switchAwayAndBack();

    expect(fetchStub.mock.calls.length).toBe(afterMount);
    expect(shownUser()).toBe("guest");
  });
});

describe("タブを切り替えても取り直さない", () => {
  it("ログイン中でも visibilitychange で /api/auth/session を叩かない", async () => {
    const fetchStub = stubFetch(() => respondWith(SIGNED_IN));

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();
    const afterMount = fetchStub.mock.calls.length;

    /*
     * next-auth の既定はフォーカスのたびに再取得で、セッションが有効なあいだは
     * 実際に毎回 fetch が走る。エディタは行き来しながら使うものなので、
     * これは体感を変えずに Workers の呼び出しを増やすだけ（ADR-001）。
     * `AuthSessionProvider` が refetchOnWindowFocus={false} で止めている。
     */
    await switchAwayAndBack();

    expect(fetchStub.mock.calls.length).toBe(afterMount);
    // 止めても本人はそのまま。ログイン状態を取りこぼさない。
    expect(JSON.parse(shownUser())).toMatchObject({ id: "u1" });
  });
});

describe("ログイン中", () => {
  it("サーバ側の getCurrentUser() と同じ形を返す", async () => {
    stubFetch(() => respondWith(SIGNED_IN));

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(JSON.parse(shownUser())).toEqual({ id: "u1", email: "a@example.com", name: "あや" });
    expect(shownLoading()).toBe("false");
  });

  it("名前が無いユーザーは name: null（undefined を漏らさない）", async () => {
    stubFetch(() => respondWith({ user: { id: "u2", email: "b@example.com" }, expires: "2999" }));

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(JSON.parse(shownUser())).toEqual({ id: "u2", email: "b@example.com", name: null });
  });

  it("id が欠けたセッションは本人と見なさない（サーバ側と同じ判定）", async () => {
    stubFetch(() => respondWith({ user: { email: "b@example.com" }, expires: "2999" }));

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(shownUser()).toBe("guest");
  });

  it("問い合わせ中は loading: true で、user は null のまま", async () => {
    // 保留中の応答。オブジェクト越しに持つのは、代入がコールバックの中で
    // 起きることを TypeScript の制御フロー解析に追わせないため。
    const pending: { release?: () => void } = {};
    stubFetch(
      () =>
        new Promise((resolve) => {
          pending.release = () =>
            resolve({ ok: true, json: () => Promise.resolve(SIGNED_IN) } as Response);
        }),
    );

    render(
      <AuthSessionProvider>
        <Probe />
      </AuthSessionProvider>,
    );
    await settle();

    expect(shownLoading()).toBe("true");
    // 確定するまでは誰でもない。ここでログイン中として扱うと同期が空振りする。
    expect(shownUser()).toBe("guest");

    pending.release?.();
    await settle();

    expect(shownLoading()).toBe("false");
    expect(JSON.parse(shownUser())).toMatchObject({ id: "u1" });
  });
});
