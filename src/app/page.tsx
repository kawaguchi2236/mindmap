"use client";

import { useEffect, useState } from "react";
import { AppHeader, AppShell } from "@/components/layout";
import { Button } from "@/components/ui";
import { MindMapEditor } from "@/features/editor";
import { useMapDocument, useOnlineStatus, type SaveStatus } from "@/features/persistence";
import { getRepository } from "@/lib/db";

/**
 * ゲストのままエディタに入る画面。
 *
 * Phase 1 の入口は「開いたらすぐ書ける」こと（CLAUDE.md §14）。ログインも
 * マップ選択も挟まず、直近のマップを開き、無ければその場で1件作る。
 * マップ一覧（/maps）は担当 B の範囲で、出来たらそちらへ導線を足す。
 */
export default function Home() {
  const [mapId, setMapId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<Error | null>(null);
  const { doc, setDoc, status, loading, error, lastSavedAt } = useMapDocument(mapId);
  const online = useOnlineStatus();

  useEffect(() => {
    let cancelled = false;

    async function openLatestMap() {
      const repository = getRepository();
      const maps = await repository.listMaps();
      const latest = maps[0];
      const target = latest ?? (await repository.createMap()).map;
      if (!cancelled) setMapId(target.id);
    }

    openLatestMap().catch((caught: unknown) => {
      const normalized = caught instanceof Error ? caught : new Error(String(caught));
      console.error("[app] マップを開けませんでした", normalized);
      if (!cancelled) setOpenError(normalized);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const failure = openError ?? error;

  return (
    <AppShell
      variant="editor"
      header={
        <AppHeader
          transparent
          title={doc?.map.title ?? "Web MindMap"}
          subtitle={describeStatus(status, lastSavedAt, online)}
        />
      }
    >
      {failure ? (
        <ErrorPanel error={failure} />
      ) : loading || !doc ? (
        <LoadingPanel />
      ) : (
        <MindMapEditor document={doc} onChange={setDoc} />
      )}
    </AppShell>
  );
}

/**
 * 保存状態の表示。CLAUDE.md §11 のとおり、役に立つときだけ出す。
 * オフラインは編集を止める理由にならないので、状態表示に留める。
 */
function describeStatus(status: SaveStatus, lastSavedAt: Date | null, online: boolean): string {
  if (status === "error") return "保存できません";
  if (status === "saving") return "保存中";
  if (!online) return "オフライン（ローカルに保存中）";
  if (status === "saved" && lastSavedAt) return `保存済み ${formatTime(lastSavedAt)}`;
  return "";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function LoadingPanel() {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
      <p style={{ color: "var(--color-text-secondary)" }}>読み込み中…</p>
    </div>
  );
}

/**
 * IndexedDB が使えない環境（プライベートウィンドウ等）はここに来る。
 * ローカルデータが危険なので黙って失敗させない（CLAUDE.md §29）。
 */
function ErrorPanel({ error }: { error: Error }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: "24px" }}>
      <div style={{ maxWidth: "40ch", textAlign: "center" }}>
        <h1 style={{ marginBottom: "8px" }}>マップを開けませんでした</h1>
        <p style={{ color: "var(--color-text-secondary)", marginBottom: "16px" }}>
          {error.name === "IndexedDbUnavailableError"
            ? "このブラウザではローカル保存が使えません。プライベートウィンドウを閉じるか、別のブラウザでお試しください。"
            : "ローカルの保存領域にアクセスできませんでした。ページを再読み込みしてください。"}
        </p>
        <Button onClick={() => window.location.reload()}>再読み込み</Button>
      </div>
    </div>
  );
}
