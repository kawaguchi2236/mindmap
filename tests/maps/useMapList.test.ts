import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNDO_WINDOW_MS, useMapList } from "@/features/maps/useMapList";
import { getRepository, resetRepositoryForTests } from "@/lib/db";

/**
 * 一覧のリポジトリ操作の結合テスト。
 *
 * fake-indexeddb を使った擬似環境での検証で、実ブラウザの IndexedDB
 * （ストレージ拒否・プライベートウィンドウ等）は再現していない。
 */

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** 初回読み込みが終わるまで待つ。 */
async function renderLoaded() {
  const view = renderHook(() => useMapList());
  await waitFor(() => expect(view.result.current.maps).not.toBeNull());
  return view;
}

describe("useMapList", () => {
  it("マップが無ければ空配列になる（null のままにしない）", async () => {
    const { result } = await renderLoaded();
    expect(result.current.maps).toEqual([]);
    expect(result.current.errorMessage).toBeNull();
  });

  it("保存済みのマップを更新日時の新しい順で読み込む", async () => {
    const repo = getRepository();
    // 同一ミリ秒での作成を避けるため、作成時だけ時刻を固定して進める。
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-13T00:00:00.000Z"));
    const older = await repo.createMap("古いマップ");
    vi.setSystemTime(new Date("2026-09-13T00:01:00.000Z"));
    await repo.createMap("新しいマップ");
    vi.useRealTimers();

    const { result } = await renderLoaded();

    expect(result.current.maps?.map((m) => m.title)).toEqual(["新しいマップ", "古いマップ"]);
    expect(result.current.maps?.[1]?.id).toBe(older.map.id);
  });

  it("create() は新しいマップを保存して id を返す", async () => {
    const { result } = await renderLoaded();

    let created: string | null = null;
    await act(async () => {
      created = await result.current.create();
    });

    expect(created).not.toBeNull();
    await waitFor(() => expect(result.current.maps).toHaveLength(1));
    expect(await getRepository().getMap(created!)).not.toBeNull();
  });

  it("rename() はタイトルだけを書き換える", async () => {
    const repo = getRepository();
    const doc = await repo.createMap("旧タイトル");
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.rename(doc.map.id, "新タイトル");
    });

    await waitFor(() => expect(result.current.maps?.[0]?.title).toBe("新タイトル"));
    const reloaded = await repo.getMap(doc.map.id);
    expect(reloaded?.map.title).toBe("新タイトル");
    expect(reloaded?.nodes).toHaveLength(doc.nodes.length);
  });

  it("remove() は論理削除で、データ本体は残っている", async () => {
    const repo = getRepository();
    const doc = await repo.createMap("消すマップ");
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.remove(doc.map.id, "消すマップ");
    });

    await waitFor(() => expect(result.current.maps).toEqual([]));
    expect(result.current.deleted).toEqual({ id: doc.map.id, title: "消すマップ" });

    // 一覧からは消えるが、墓標つきで中身は保持されている（CLAUDE.md §6）。
    expect(await repo.getMap(doc.map.id)).toBeNull();
    const buried = await repo.getMap(doc.map.id, { includeDeleted: true });
    expect(buried?.map.deletedAt).not.toBeNull();
    expect(buried?.nodes).toHaveLength(doc.nodes.length);
  });

  it("undoRemove() で削除を取り消せる", async () => {
    const repo = getRepository();
    const doc = await repo.createMap("戻すマップ");
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.remove(doc.map.id, "戻すマップ");
    });
    await waitFor(() => expect(result.current.maps).toEqual([]));

    await act(async () => {
      await result.current.undoRemove();
    });

    await waitFor(() => expect(result.current.maps).toHaveLength(1));
    expect(result.current.maps?.[0]?.id).toBe(doc.map.id);
    expect(result.current.deleted).toBeNull();
  });

  it("取り消しの受付は一定時間で自動的に閉じる", async () => {
    // setImmediate まで偽物にすると fake-indexeddb のイベント配送が狂うため、
    // 取り消し時間の計測に使うタイマーだけを偽装する。
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    const repo = getRepository();
    const doc = await repo.createMap("時間切れ");
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.remove(doc.map.id, "時間切れ");
    });
    expect(result.current.deleted).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
    });
    expect(result.current.deleted).toBeNull();
  });

  it("dismissRemove() で取り消しトーストを閉じても、削除は取り消さない", async () => {
    const repo = getRepository();
    const doc = await repo.createMap("閉じるだけ");
    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.remove(doc.map.id, "閉じるだけ");
    });
    await waitFor(() => expect(result.current.maps).toEqual([]));

    act(() => {
      result.current.dismissRemove();
    });

    expect(result.current.deleted).toBeNull();
    expect(result.current.maps).toEqual([]);
  });

  it("読み込みに失敗したら黙らず、生の例外メッセージも出さない", async () => {
    const repo = getRepository();
    vi.spyOn(repo, "listMaps").mockRejectedValue(
      new Error("InvalidStateError: backing store failed"),
    );

    const { result } = renderHook(() => useMapList());

    await waitFor(() => expect(result.current.errorMessage).not.toBeNull());
    // 「0件」と誤解させないため、失敗時は null のままにする。
    expect(result.current.maps).toBeNull();
    expect(result.current.errorMessage).toContain("マップ一覧を読み込めませんでした");
    expect(result.current.errorMessage).not.toContain("InvalidStateError");
  });

  it("IndexedDB が使えない環境では、その旨を画面に出せる文言にする", async () => {
    const repo = getRepository();
    const { IndexedDbUnavailableError } = await import("@/lib/db");
    vi.spyOn(repo, "createMap").mockRejectedValue(new IndexedDbUnavailableError());

    const { result } = await renderLoaded();

    let created: string | null = "sentinel";
    await act(async () => {
      created = await result.current.create();
    });

    expect(created).toBeNull();
    expect(result.current.errorMessage).toContain("新しいマップを作成できませんでした");
    expect(result.current.errorMessage).toContain("ローカルに保存できません");
  });
});
