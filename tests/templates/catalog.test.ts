import { describe, expect, it } from "vitest";
import type { TemplateNode } from "@/features/templates";
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

  /**
   * テンプレートの値は「その枠組みの型」なので、階層の役割を揃えてある
   * （catalog.ts のヘッダー参照）。第3階層が無いテンプレートは
   * 「箱だけ並べて記入の仕方を示していない」状態なので落とす。
   */
  it("どのテンプレートも第2階層（枠組みの箱）と第3階層（記入の仕方）を持つ", () => {
    for (const template of TEMPLATES) {
      const branches = template.tree?.children ?? [];
      expect(branches.length, `${template.name}: 第2階層がありません`).toBeGreaterThan(1);
      const withSlots = branches.filter((branch) => (branch.children ?? []).length > 0);
      expect(withSlots.length, `${template.name}: 第3階層がありません`).toBeGreaterThan(0);
    }
  });

  /**
   * 「どれを選んでも同じ形」に戻らないための歯止め。
   * 第2階層の並びが一致するテンプレートが2つあったら、型の作り分けができていない。
   */
  it("テンプレートごとに第2階層の構成が異なる（同じ形が2つ無い）", () => {
    const shapes = new Map<string, string>();
    for (const template of TEMPLATES) {
      const shape = (template.tree?.children ?? []).map((branch) => branch.text).join(" / ");
      const duplicate = shapes.get(shape);
      expect(duplicate, `${template.name} と ${duplicate} が同じ形です: ${shape}`).toBeUndefined();
      shapes.set(shape, template.name);
    }
  });

  /**
   * ロジックツリーは1本につき1つの型（Why ツリー）。種類を混ぜると型が崩れる。
   *
   * 切り口が2本しかないと、対等な主要因を「その他（漏れの受け皿）」に
   * 押し込むことになる（受け皿は残りかす用）。実デモ（解約率の原因追及）で
   * 最重要の仮説が受け皿行きになったので、3本以上を下限として固定する。
   */
  it("ロジックツリーは Why ツリー1種で、切り口3本＋受け皿＋結論を持つ", () => {
    const logic = TEMPLATES.find((template) => template.id === "logic-tree");
    expect(logic).toBeDefined();
    const branches = logic!.tree?.children ?? [];
    const causes = branches.filter((branch) => branch.text.startsWith("原因"));
    expect(causes.length, "切り口が3本ありません").toBeGreaterThanOrEqual(3);
    expect(branches.some((branch) => branch.text.includes("その他"))).toBe(true);
    // 仮説を並べて終わりにせず、打ち手に着地させる箱を持つ。
    const conclusion = branches.find((branch) => branch.text.includes("結論"));
    expect(conclusion?.children ?? []).not.toHaveLength(0);
    // 原因の枝の子は「なぜ？」で割れている（結論の枝は別の型なので対象外）。
    for (const cause of causes) {
      for (const leaf of cause.children ?? []) {
        expect(leaf.text).toMatch(/なぜ/);
      }
    }
  });

  /**
   * ここから下は、実デモケースを各テンプレートに流し込んで見つかった
   * 「埋めると壊れる」欠陥の再発防止。どれも構造を戻すと実用性が落ちる。
   */

  /**
   * ロードマップ: 成功指標はアウトカムの**子**。兄弟に並べると、
   * 成果を2つ書いた時点でどの目印がどの成果のものか読めなくなる。
   */
  it("ロードマップの完了の目印は、狙う成果の子になっている", () => {
    const roadmap = TEMPLATES.find((template) => template.id === "roadmap");
    const now = (roadmap!.tree?.children ?? []).find((branch) => branch.text.startsWith("Now"));
    const outcomes = now?.children ?? [];
    // Now には最初からアウトカムが2枠ある（1枠だと足すときに形が崩れる）。
    expect(outcomes.length).toBeGreaterThanOrEqual(2);
    for (const outcome of outcomes) {
      expect(outcome.text).toContain("狙う成果");
      expect(outcome.children?.some((child) => child.text.includes("目印"))).toBe(true);
    }
    // 目印が第2階層の直下（＝成果と兄弟）に漏れていない。
    for (const branch of roadmap!.tree?.children ?? []) {
      for (const child of branch.children ?? []) {
        if (child.text.includes("目印")) expect(child.text).toContain("狙う成果");
      }
    }
  });

  /** 読書メモ: 気づきは引用の子。兄弟だと、どの引用への反応か辿れない。 */
  it("読書メモの気づきは、引用文の子になっている", () => {
    const reading = TEMPLATES.find((template) => template.id === "reading");
    const quotes = (reading!.tree?.children ?? []).find((branch) => branch.text.startsWith("引用"));
    const quote = (quotes?.children ?? [])[0];
    expect(quote?.text).toMatch(/^p\./);
    expect(quote?.children?.some((child) => child.text.includes("気づき"))).toBe(true);
  });

  /**
   * 枠組みの通称の順と、上から埋めるキーボード操作が衝突するテンプレート。
   * 通称の順に戻すと最初の箱で手が止まる（学習ノートは講義中に書けない、
   * キャリアは「やりたいこと」から書けない）ので、先頭を固定する。
   */
  it("学習ノートとキャリアは、通称の順ではなく書く順に並んでいる", () => {
    const study = TEMPLATES.find((template) => template.id === "study");
    const studyBranches = (study!.tree?.children ?? []).map((branch) => branch.text);
    expect(studyBranches.findIndex((text) => text.startsWith("ノート"))).toBeLessThan(
      studyBranches.findIndex((text) => text.startsWith("キーワード")),
    );

    const career = TEMPLATES.find((template) => template.id === "career");
    expect((career!.tree?.children ?? [])[0]?.text).toMatch(/^Can/);
  });

  /**
   * 深さの上限。第4階層は「深さ自体が枠組みの一部」の3つだけに許す
   * （catalog.ts 冒頭の約束）。歯止めが無いと、どのテンプレートも深くなる。
   */
  it("第4階層を持つのはロジックツリー・ロードマップ・読書メモだけ", () => {
    const depthOf = (node: TemplateNode): number =>
      1 + Math.max(0, ...(node.children ?? []).map(depthOf));
    const deep = TEMPLATES.filter((template) => depthOf(template.tree!) > 3).map(
      (template) => template.id,
    );
    expect(deep.sort()).toEqual(["logic-tree", "reading", "roadmap"]);
    for (const template of TEMPLATES) {
      expect(
        depthOf(template.tree!),
        `${template.name}: 5階層以上は深すぎます`,
      ).toBeLessThanOrEqual(4);
    }
  });

  it("空のマップは木を持たず、START BLANK と表示する", () => {
    expect(BLANK_TEMPLATE.tree).toBeNull();
    expect(describeTemplate(BLANK_TEMPLATE)).toBe("START BLANK");
  });

  /**
   * 一覧での名前（「空のマップ」）がそのままマップ名になると、白紙から作った
   * マップが全部同じ名前で並んで見分けられない。作られるマップの名前は別に持つ。
   */
  it("空のマップは、一覧の名前とは別のマップタイトルを持つ", () => {
    expect(BLANK_TEMPLATE.title).toBeDefined();
    expect(BLANK_TEMPLATE.title).not.toBe(BLANK_TEMPLATE.name);
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
