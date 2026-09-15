import { describe, expect, it } from "vitest";
import {
  BLANK_TEMPLATE,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  buildTemplateNodes,
  countNodes,
  describeTemplate,
} from "@/features/templates";
import { getRoot, getVisibleNodes } from "@/features/editor/tree";
import { nodeBox } from "@/features/editor/layout";
import { buildDepthIndex } from "@/features/editor/tree";

/**
 * テンプレートの中身の検証。
 *
 * 画面の見た目ではなく「選んだら壊れていないマップになる」ことを見る。
 * テンプレートは保存されたら取り消せないので、木が不正なまま保存される経路を
 * 作らないことが大事（CLAUDE.md §6）。
 */

const ALL = [...TEMPLATES, BLANK_TEMPLATE];

describe("テンプレートの定義", () => {
  it("id が重複していない", () => {
    const ids = ALL.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("どの分類にも最低1つのテンプレートがある（空のタブを作らない）", () => {
    for (const category of TEMPLATE_CATEGORIES) {
      expect(
        TEMPLATES.filter((template) => template.category === category).length,
        `分類「${category}」にテンプレートがありません`,
      ).toBeGreaterThan(0);
    }
  });

  it("空のマップ以外は木を持ち、ノード数の表記と中身が一致する", () => {
    for (const template of TEMPLATES) {
      expect(template.tree).not.toBeNull();
      expect(describeTemplate(template)).toBe(
        `${countNodes(template.tree)} NODES · ${template.category}`,
      );
    }
  });

  it("空のマップは木を持たず、START BLANK と表示する", () => {
    expect(BLANK_TEMPLATE.tree).toBeNull();
    expect(describeTemplate(BLANK_TEMPLATE)).toBe("START BLANK");
  });
});

describe("buildTemplateNodes", () => {
  it("ルートが1つだけで、全ノードが同じ mapId を持つ", () => {
    for (const template of TEMPLATES) {
      const nodes = buildTemplateNodes("map-1", template.tree!);
      expect(nodes.filter((node) => node.parentId === null)).toHaveLength(1);
      expect(nodes.every((node) => node.mapId === "map-1")).toBe(true);
      expect(nodes).toHaveLength(countNodes(template.tree));
    }
  });

  it("id が重複せず、親はすべて同じマップの中にいる", () => {
    for (const template of TEMPLATES) {
      const nodes = buildTemplateNodes("map-1", template.tree!);
      const ids = new Set(nodes.map((node) => node.id));
      expect(ids.size).toBe(nodes.length);
      for (const node of nodes) {
        if (node.parentId !== null) expect(ids.has(node.parentId)).toBe(true);
      }
    }
  });

  it("ルートのテキストが木の先頭と一致する（一覧のタイトルの既定値になる）", () => {
    for (const template of TEMPLATES) {
      const nodes = buildTemplateNodes("map-1", template.tree!);
      expect(getRoot(nodes)?.text).toBe(template.tree!.text);
    }
  });

  it("自動レイアウト済みで、ノードが1組も重ならない", () => {
    for (const template of TEMPLATES) {
      const nodes = buildTemplateNodes("map-1", template.tree!);
      const depths = buildDepthIndex(nodes);
      const rects = getVisibleNodes(nodes).map((node) => {
        const box = nodeBox(node.text, depths.get(node.id) ?? 0);
        return {
          text: node.text,
          left: node.x,
          right: node.x + box.width,
          top: node.y,
          bottom: node.y + box.height,
        };
      });
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i];
          const b = rects[j];
          const hit = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(hit, `${template.name}: 「${a.text}」と「${b.text}」が重なっています`).toBe(false);
        }
      }
    }
  });
});
