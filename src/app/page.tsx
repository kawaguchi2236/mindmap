"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppHeader, AppShell } from "@/components/layout";
import { Button } from "@/components/ui";
import { MindMapEditor } from "@/features/editor";
import { useMapDocument, useOnlineStatus, type SaveStatus } from "@/features/persistence";
import { getRepository } from "@/lib/db";

/**
 * エディタ画面。
 *
 * Phase 1 の入口は「開いたらすぐ書ける」こと（CLAUDE.md §14）。ログインも
 * マップ選択も挟まず、いきなりキャンバスに入る。
 *
 * - `/?map=<id>` … そのマップを開く（マップ一覧からの導線）
 * - `/`          … 直近に更新したマップを開く。1件も無ければその場で作る
 *
 * エディタ画面はここ1つだけにする。画面が2つあると、キャンバスの修正が
 * 片方にしか当たらない状態が生まれるため。
 */
export default function Home() {
  // useSearchParams は Suspense 境界を要求する（/ は静的プリレンダリング）。
  return (
    <Suspense fallback={<Centered>読み込み中…</Centered>}>
      <EditorPage />
    </Suspense>
  );
}

type OpenState =
  | { phase: "opening" }
  | { phase: "ready"; mapId: string }
  | { phase: "missing"; requestedId: string }
  | { phase: "failed"; error: Error };

function EditorPage() {
  const router = useRouter();
  const requestedId = useSearchParams().get("map");
  const [open, setOpen] = useState<OpenState>({ phase: "opening" });

  useEffect(() => {
    let cancelled = false;
    const repository = getRepository();

    // 開くべきマップを1つ決める。setState は Promise のコールバックの中だけで行う。
    const resolve: Promise<OpenState> = requestedId
      ? repository.getMap(requestedId).then((requested) =>
          // 見つからないときに別のマップを黙って開くと、一覧で選んだものと
          // 違うマップを編集してしまう。開かずに知らせる。
          requested
            ? ({ phase: "ready", mapId: requested.map.id } as const)
            : ({ phase: "missing", requestedId } as const),
        )
      : repository
          .listMaps()
          .then(async (maps) => maps[0] ?? (await repository.createMap()).map)
          .then((target) => {
            // リロードや共有で同じマップに戻れるよう URL に残す。
            router.replace(`/?map=${target.id}`, { scroll: false });
            return { phase: "ready", mapId: target.id } as const;
          });

    resolve
      .then((next) => {
        if (!cancelled) setOpen(next);
      })
      .catch((caught: unknown) => {
        const error = caught instanceof Error ? caught : new Error(String(caught));
        console.error("[app] マップを開けませんでした", error);
        if (!cancelled) setOpen({ phase: "failed", error });
      });

    return () => {
      cancelled = true;
    };
  }, [requestedId, router]);

  return <Editor open={open} onOpenLatest={() => router.replace("/", { scroll: false })} />;
}

function Editor({ open, onOpenLatest }: { open: OpenState; onOpenLatest: () => void }) {
  const mapId = open.phase === "ready" ? open.mapId : null;
  const { doc, setDoc, status, loading, error, lastSavedAt } = useMapDocument(mapId);
  const online = useOnlineStatus();

  const failure = open.phase === "failed" ? open.error : error;

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
      ) : open.phase === "missing" ? (
        <MissingPanel onOpenLatest={onOpenLatest} />
      ) : loading || !doc ? (
        <Centered>読み込み中…</Centered>
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-centered">
      <p className="app-centered__muted">{children}</p>
    </div>
  );
}

function MissingPanel({ onOpenLatest }: { onOpenLatest: () => void }) {
  return (
    <div className="app-centered">
      <div className="app-centered__box">
        <h1>マップが見つかりません</h1>
        <p className="app-centered__muted">
          削除されたか、URL が間違っている可能性があります。データは消していません。
        </p>
        <Button onClick={onOpenLatest}>最近のマップを開く</Button>
      </div>
    </div>
  );
}

/**
 * IndexedDB が使えない環境（プライベートウィンドウ等）はここに来る。
 * ローカルデータが危険なので黙って失敗させない（CLAUDE.md §29）。
 */
function ErrorPanel({ error }: { error: Error }) {
  return (
    <div className="app-centered">
      <div className="app-centered__box">
        <h1>マップを開けませんでした</h1>
        <p className="app-centered__muted">
          {error.name === "IndexedDbUnavailableError"
            ? "このブラウザではローカル保存が使えません。プライベートウィンドウを閉じるか、別のブラウザでお試しください。"
            : "ローカルの保存領域にアクセスできませんでした。ページを再読み込みしてください。"}
        </p>
        <Button onClick={() => window.location.reload()}>再読み込み</Button>
      </div>
    </div>
  );
}
