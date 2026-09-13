import { describe, expect, it } from "vitest";
import { createMapDocument, DEFAULT_MAP_TITLE } from "@/lib/model/factory";
import { withRootDerivedTitle } from "@/lib/model/title";
import type { MindMapDocument } from "@/lib/model/types";

function setRootText(doc: MindMapDocument, text: string): MindMapDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.parentId === null ? { ...node, text } : node)),
  };
}

function withTitle(doc: MindMapDocument, title: string): MindMapDocument {
  return { ...doc, map: { ...doc.map, title } };
}

describe("withRootDerivedTitle", () => {
  it("まだ名前を付けていないマップは、ルートのテキストがタイトルになる", () => {
    const before = createMapDocument();
    const after = setRootText(before, "新規事業の企画");
    expect(withRootDerivedTitle(before, after).map.title).toBe("新規事業の企画");
  });

  it("いったん追従したあとも、ルートを書き換えれば追従し続ける", () => {
    const first = withRootDerivedTitle(
      createMapDocument(),
      setRootText(createMapDocument(), "企画"),
    );
    const second = setRootText(first, "企画（改訂）");
    expect(withRootDerivedTitle(first, second).map.title).toBe("企画（改訂）");
  });

  it("一覧で明示的に付けた名前は、ルートを書き換えても上書きしない", () => {
    const renamed = withTitle(createMapDocument(), "四半期レビュー");
    const after = setRootText(renamed, "まったく別の言葉");
    expect(withRootDerivedTitle(renamed, after).map.title).toBe("四半期レビュー");
  });

  it("ルートを空にしてもタイトルを消さない", () => {
    const named = withRootDerivedTitle(
      createMapDocument(),
      setRootText(createMapDocument(), "企画"),
    );
    const cleared = setRootText(named, "   ");
    expect(withRootDerivedTitle(named, cleared).map.title).toBe("企画");
  });

  it("前後の比較対象が無くても落ちない（初回読み込み直後）", () => {
    const doc = setRootText(createMapDocument(), "初回");
    expect(withRootDerivedTitle(null, doc).map.title).toBe("初回");
  });

  it("タイトルと同じ内容に書き換えたときは新しいオブジェクトを作らない", () => {
    const doc = withTitle(setRootText(createMapDocument(), "同じ"), "同じ");
    expect(withRootDerivedTitle(doc, doc)).toBe(doc);
  });

  it("既定タイトルのままルートが空なら、何も変えない", () => {
    const doc = createMapDocument();
    expect(withRootDerivedTitle(null, doc).map.title).toBe(DEFAULT_MAP_TITLE);
  });
});
