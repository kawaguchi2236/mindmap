import { describe, expect, it } from "vitest";
import {
  filterMapsByTitle,
  normalizeForSearch,
  sortMapsByUpdatedAt,
  visibleMaps,
} from "@/features/maps/select";
import type { MindMapSummary } from "@/lib/model/types";

function summary(overrides: Partial<MindMapSummary> & Pick<MindMapSummary, "id">): MindMapSummary {
  return {
    title: "無題のマップ",
    updatedAt: "2026-09-13T12:00:00.000Z",
    createdAt: "2026-09-13T12:00:00.000Z",
    nodeCount: 1,
    syncState: "local-only",
    userId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("normalizeForSearch", () => {
  it("前後の空白を落とし、大文字小文字を無視する", () => {
    expect(normalizeForSearch("  MindMap  ")).toBe("mindmap");
  });

  it("全角英数を半角に揃える（日本語入力で実際に起きる）", () => {
    expect(normalizeForSearch("ＡＢＣ１２３")).toBe("abc123");
  });
});

describe("filterMapsByTitle", () => {
  const maps = [
    summary({ id: "a", title: "LaterList" }),
    summary({ id: "b", title: "3Dプリンタ" }),
    summary({ id: "c", title: "読書メモ" }),
  ];

  it("空の検索語では全件返す", () => {
    expect(filterMapsByTitle(maps, "")).toHaveLength(3);
    expect(filterMapsByTitle(maps, "   ")).toHaveLength(3);
  });

  it("部分一致・大文字小文字を区別しない", () => {
    expect(filterMapsByTitle(maps, "later").map((m) => m.id)).toEqual(["a"]);
    expect(filterMapsByTitle(maps, "LIST").map((m) => m.id)).toEqual(["a"]);
  });

  it("日本語の部分一致も効く", () => {
    expect(filterMapsByTitle(maps, "プリンタ").map((m) => m.id)).toEqual(["b"]);
  });

  it("全角で打った検索語が半角のタイトルに一致する", () => {
    expect(filterMapsByTitle(maps, "３Ｄ").map((m) => m.id)).toEqual(["b"]);
  });

  it("一致しなければ空配列", () => {
    expect(filterMapsByTitle(maps, "存在しない")).toEqual([]);
  });

  it("元の配列を書き換えない", () => {
    const before = [...maps];
    filterMapsByTitle(maps, "later");
    expect(maps).toEqual(before);
  });
});

describe("sortMapsByUpdatedAt", () => {
  it("更新日時の新しい順に並べる", () => {
    const sorted = sortMapsByUpdatedAt([
      summary({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
      summary({ id: "new", updatedAt: "2026-09-13T00:00:00.000Z" }),
      summary({ id: "mid", updatedAt: "2026-09-07T00:00:00.000Z" }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["new", "mid", "old"]);
  });

  it("更新日時が同じなら作成日時の新しい順", () => {
    const sorted = sortMapsByUpdatedAt([
      summary({ id: "x", createdAt: "2026-09-01T00:00:00.000Z" }),
      summary({ id: "y", createdAt: "2026-09-05T00:00:00.000Z" }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["y", "x"]);
  });

  it("完全に同時刻でも並びが毎回同じになる（id で決着をつける）", () => {
    const input = [summary({ id: "b" }), summary({ id: "a" }), summary({ id: "c" })];
    expect(sortMapsByUpdatedAt(input).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(sortMapsByUpdatedAt([...input].reverse()).map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("入力配列を破壊しない", () => {
    const input = [
      summary({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
      summary({ id: "new", updatedAt: "2026-09-13T00:00:00.000Z" }),
    ];
    sortMapsByUpdatedAt(input);
    expect(input.map((m) => m.id)).toEqual(["old", "new"]);
  });
});

describe("visibleMaps", () => {
  const maps = [
    summary({ id: "alive-old", title: "古いメモ", updatedAt: "2026-09-01T00:00:00.000Z" }),
    summary({ id: "alive-new", title: "新しいメモ", updatedAt: "2026-09-13T00:00:00.000Z" }),
    summary({
      id: "gone",
      title: "消したメモ",
      updatedAt: "2026-09-20T00:00:00.000Z",
      deletedAt: "2026-09-20T01:00:00.000Z",
    }),
  ];

  it("論理削除済みは（どれだけ新しくても）出さない", () => {
    expect(visibleMaps(maps, "").map((m) => m.id)).toEqual(["alive-new", "alive-old"]);
  });

  it("削除済みは検索にも引っかからない", () => {
    expect(visibleMaps(maps, "消した")).toEqual([]);
  });

  it("絞り込んだ結果も更新日時の新しい順", () => {
    expect(visibleMaps(maps, "メモ").map((m) => m.id)).toEqual(["alive-new", "alive-old"]);
  });
});
