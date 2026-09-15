"use client";

/**
 * テンプレート一覧（docs/要件定義.md SCR-005 / design/ハンドオフ.md `#3c`）。
 *
 * ゲストのまま使える。選ぶとローカルの IndexedDB にマップを作ってエディタへ入る。
 * ここは広告を出してよい画面（CLAUDE.md §15: 一覧・設定・テンプレート）。
 *
 * 見た目の作法はマップ一覧（`#2c`）と揃える。枠・カードは使わず、余白と
 * 罫線だけで構造を出す。ダークモードの分岐は書かない（globals.css の
 * トークンが3状態ぶん定義済み）。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { AppHeader, AppShell } from "@/components/layout";
import { AdSlot } from "@/features/ads";
import { getRepository } from "@/lib/db";
import {
  BLANK_TEMPLATE,
  TEMPLATES,
  TEMPLATE_CATEGORIES,
  buildTemplateNodes,
  describeTemplate,
  type Template,
  type TemplateCategory,
} from "./catalog";
import { TemplatePreview } from "./TemplatePreview";
import styles from "./TemplateScreen.module.css";

export interface TemplateScreenProps {
  /** ログイン中かどうか。広告を出すかの判断にだけ使う。 */
  signedIn: boolean;
}

/** 絞り込みの状態。ハンドオフのタブに「すべて」を足している（既定）。 */
type Filter = "all" | TemplateCategory;

export function TemplateScreen({ signedIn }: TemplateScreenProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [startingId, setStartingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const start = useCallback(
    async (template: Template) => {
      setStartingId(template.id);
      setErrorMessage(null);
      try {
        const repository = getRepository();
        // ルート1つのマップを作ってから、テンプレートの木で上書きする。
        // createMap が版と時刻を進める契約なので、ここでは触らない。
        const created = await repository.createMap(template.title ?? template.name);
        if (template.tree !== null) {
          await repository.saveMap({
            ...created,
            nodes: buildTemplateNodes(created.map.id, template.tree),
          });
        }
        router.push(`/?map=${created.map.id}`);
      } catch (caught: unknown) {
        console.error("[templates] テンプレートから作成できませんでした", caught);
        setStartingId(null);
        // ローカル保存が使えない環境では黙って失敗させない（CLAUDE.md §29）。
        setErrorMessage(
          "マップを作れませんでした。このブラウザでローカル保存が使えるかご確認ください。",
        );
      }
    },
    [router],
  );

  const items = [...TEMPLATES, BLANK_TEMPLATE].filter(
    // 「空のマップ」はどの絞り込みでも最後に残す（いつでも白紙から始められる）。
    (template) =>
      filter === "all" || template.id === BLANK_TEMPLATE.id || template.category === filter,
  );

  return (
    <AppShell
      header={
        <AppHeader
          title="MindMap"
          actions={
            <nav className={styles.nav} aria-label="画面">
              <Link className={styles.navLink} href="/maps">
                マップ
              </Link>
              <Link className={styles.navLink} href="/templates" aria-current="page">
                テンプレート
              </Link>
              <Link className={styles.navLink} href="/settings">
                設定
              </Link>
            </nav>
          }
        />
      }
    >
      <div className={styles.head}>
        <h1 className={styles.title}>テンプレート</h1>
        <div className={styles.tabs} role="group" aria-label="分類">
          <FilterTab current={filter} value="all" label="すべて" onSelect={setFilter} />
          {TEMPLATE_CATEGORIES.map((category) => (
            <FilterTab
              key={category}
              current={filter}
              value={category}
              label={category}
              onSelect={setFilter}
            />
          ))}
        </div>
      </div>
      {/* 新聞のヘッドルール（太細ペア）。太罫は .head の border-bottom。 */}
      <div className={styles.headRule} aria-hidden="true" />

      {errorMessage !== null && (
        <p role="alert" className={styles.notice}>
          {errorMessage}
        </p>
      )}

      <ul className={styles.grid}>
        {items.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className={styles.item}
              onClick={() => void start(template)}
              disabled={startingId !== null}
              data-blank={template.tree === null || undefined}
            >
              <span className={styles.preview}>
                <TemplatePreview kind={template.preview} />
              </span>
              <span className={styles.name}>{template.name}</span>
              <span className={styles.meta}>
                {startingId === template.id ? "作成中…" : describeTemplate(template)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* 広告帯。テンプレート画面は表示可の画面（docs/要件定義.md FR-ADS-002）。 */}
      <AdSlot slot="templates" signedIn={signedIn} />
    </AppShell>
  );
}

function FilterTab({
  current,
  value,
  label,
  onSelect,
}: {
  current: Filter;
  value: Filter;
  label: string;
  onSelect: (value: Filter) => void;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      className={styles.tab}
      data-selected={selected || undefined}
      aria-pressed={selected}
      onClick={() => onSelect(value)}
    >
      {label}
    </button>
  );
}
