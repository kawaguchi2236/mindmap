import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { getRepository, resetRepositoryForTests } from "@/lib/db";
import { useAutosave } from "@/features/persistence/useAutosave";
import { useMapDocument } from "@/features/persistence/useMapDocument";
import { createNode } from "@/lib/model/factory";
import type { MapRepository } from "@/lib/db/types";
import type { MindMapDocument } from "@/lib/model/types";

let repo: MapRepository;

beforeEach(async () => {
  await resetRepositoryForTests();
  globalThis.indexedDB = new IDBFactory();
  repo = getRepository();
  // setImmediate まで偽物にすると fake-indexeddb のイベント配送が狂うため、
  // デバウンスに必要なタイマーだけを偽装する。
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function withText(doc: MindMapDocument, text: string): MindMapDocument {
  const [root, ...rest] = doc.nodes;
  return { ...doc, nodes: [{ ...root, text }, ...rest] };
}

describe("useAutosave", () => {
  it("読み込み直後は保存せず、変更をデバウンスしてから保存する", async () => {
    const created = await repo.createMap("デバウンス");
    const saveSpy = vi.spyOn(repo, "saveMap");

    const { rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 500 }), {
      initialProps: { doc: created },
    });

    // 最初の1件は「読み込んだだけ」なので保存しない。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(saveSpy).not.toHaveBeenCalled();

    rerender({ doc: withText(created, "あ") });
    // デバウンス中はまだ書かない。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(saveSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });

  it("連続変更では最後の内容だけが保存される", async () => {
    const created = await repo.createMap("連打");
    const saveSpy = vi.spyOn(repo, "saveMap");

    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 500 }), {
      initialProps: { doc: created },
    });

    for (const text of ["あ", "あい", "あいう", "あいうえ", "あいうえお"]) {
      rerender({ doc: withText(created, text) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(saveSpy).toHaveBeenCalledTimes(1);

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.nodes[0].text).toBe("あいうえお");
    expect(result.current.lastSavedAt).toBeInstanceOf(Date);
    expect(result.current.error).toBeNull();
  });

  it("保存中に届いた変更も取りこぼさずもう一度保存する", async () => {
    const created = await repo.createMap("保存中の変更");
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const real = repo.saveMap.bind(repo);
    const saveSpy = vi.spyOn(repo, "saveMap").mockImplementationOnce(async (doc) => {
      await gate;
      return real(doc);
    });

    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 100 }), {
      initialProps: { doc: created },
    });

    rerender({ doc: withText(created, "1回目") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);

    // まだ1回目の保存が終わっていないうちに次の変更が届く。
    rerender({ doc: withText(created, "2回目") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
      release?.();
      await vi.advanceTimersByTimeAsync(150);
    });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.nodes[0].text).toBe("2回目");
  });

  it("flush() でデバウンスを待たずに保存する", async () => {
    const created = await repo.createMap("flush");
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 5000 }), {
      initialProps: { doc: created },
    });

    rerender({ doc: withText(created, "即時") });
    await act(async () => {
      await result.current.flush();
    });

    expect((await repo.getMap(created.map.id))!.nodes[0].text).toBe("即時");
  });

  it("保存に失敗しても例外は呼び出し側に漏れず、編集を続けられる", async () => {
    const created = await repo.createMap("失敗");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saveSpy = vi
      .spyOn(repo, "saveMap")
      .mockRejectedValueOnce(new Error("IndexedDB が一杯です"));

    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 100 }), {
      initialProps: { doc: created },
    });

    rerender({ doc: withText(created, "失敗する変更") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("IndexedDB が一杯です");

    // 次の変更では通常どおり保存される（編集が止まらない）。
    saveSpy.mockRestore();
    rerender({ doc: withText(created, "次の変更") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect((await repo.getMap(created.map.id))!.nodes[0].text).toBe("次の変更");
  });

  it("何度も保存しても StaleWriteError にならない（version を追従する）", async () => {
    const created = await repo.createMap("連続保存");
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 50 }), {
      initialProps: { doc: created },
    });

    // 画面側は同じ（version の古い）doc を持ち続けたまま編集を重ねる。
    for (const text of ["1", "2", "3"]) {
      rerender({ doc: withText(created, text) });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      await waitFor(() => expect(result.current.status).toBe("saved"));
    }

    expect(result.current.error).toBeNull();
    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.nodes[0].text).toBe("3");
    expect(loaded!.map.version).toBe(created.map.version + 3);
  });
});

describe("useMapDocument", () => {
  it("読み込み → setDoc → 自動保存 まで通る", async () => {
    const created = await repo.createMap("フック経由");
    const child = createNode({ mapId: created.map.id, parentId: created.nodes[0].id, text: "子" });

    const { result } = renderHook(() => useMapDocument(created.map.id));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.doc!.map.title).toBe("フック経由");

    act(() => {
      result.current.setDoc({
        ...result.current.doc!,
        nodes: [...result.current.doc!.nodes, child],
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await waitFor(() => expect(result.current.status).toBe("saved"));

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.nodes).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("mapId が null なら読み込まない", async () => {
    const { result } = renderHook(() => useMapDocument(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.doc).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("読み込みに失敗しても例外にならず error に入る", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repo, "getMap").mockRejectedValueOnce(new Error("IndexedDB を利用できません。"));

    const { result } = renderHook(() => useMapDocument("any-id"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.doc).toBeNull();
    expect(result.current.error?.message).toBe("IndexedDB を利用できません。");
  });
});

describe("他経路の更新との競合", () => {
  it("編集中に renameMap で version が進んでも、編集内容を失わずに保存できる", async () => {
    const created = await repo.createMap("元タイトル");
    const { result, rerender } = renderHook(({ doc }) => useAutosave(doc, { debounceMs: 100 }), {
      initialProps: { doc: created },
    });

    // 一覧画面などからタイトルが変更され、保存済み version が進む。
    await repo.renameMap(created.map.id, "別経路で変えたタイトル");

    rerender({ doc: withText(created, "編集中のテキスト") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(result.current.error).toBeNull();

    const loaded = await repo.getMap(created.map.id);
    expect(loaded!.nodes[0].text).toBe("編集中のテキスト");
  });
});
