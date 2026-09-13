"use client";

/**
 * マップ一覧画面（task.md §5）。
 *
 * ゲストのまま全機能が使える。ログインは表示を少し足すだけで、
 * 一覧・作成・名前変更・削除はすべてローカルの IndexedDB だけで完結する
 * （CLAUDE.md §14）。ローカル永続化はブラウザ API なので、この画面は
 * クライアントコンポーネントで、データ取得はすべてマウント後に行う。
 *
 * 見た目は担当 A のデザインシステム（src/components/**）に乗せる。
 * 色・余白・影は必ずトークン変数を使い、ダークモードの分岐は書かない
 * （3状態ぶんのトークンが定義済みなので var() を使えば自動で追従する）。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppHeader, AppShell, Sidebar } from "@/components/layout";
import { Button, Icon, Input, Modal } from "@/components/ui";
import { AdSlot } from "@/features/ads";
import { SyncRunner } from "@/features/sync";
import type { ID, MindMapSummary } from "@/lib/model/types";
import { describeSyncState, formatIndex, formatRelativeTime } from "./format";
import { visibleMaps } from "./select";
import { useMapList } from "./useMapList";
import { useNow } from "./useNow";
import styles from "./MapListScreen.module.css";

export interface MapListScreenProps {
  /**
   * ログイン中かどうか。ゲストでも一覧の全機能が使えるため、
   * ここは「同期状態を出すか」だけを決める表示上のフラグ。
   */
  signedIn: boolean;
  /**
   * ログイン中のユーザー ID。ゲストは null（既定）。
   *
   * これが渡されている間だけ、この画面にいるあいだのクラウド同期が動く。
   * `signedIn` と重なって見えるが、同期エンジンは所有者の付け替えに
   * 実際の ID を要るので、真偽値では代用できない。
   */
  userId?: string | null;
}

/** 削除確認ダイアログの対象。 */
interface DeleteTarget {
  id: ID;
  title: string;
}

export function MapListScreen({ signedIn, userId = null }: MapListScreenProps) {
  const router = useRouter();
  const { maps, errorMessage, deleted, reload, create, rename, remove, undoRemove, dismissRemove } =
    useMapList();

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<ID | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  /*
   * 相対日時はマウント後にだけ確定させる（サーバ描画時の時刻を使うと
   * クライアントとの差でハイドレーション不一致になる）。1分ごとに更新して
   * 「3分前」の表示を実時間に追従させる。
   */
  const now = useNow();

  const handleCreate = useCallback(async () => {
    setCreating(true);
    const id = await create();
    setCreating(false);
    // 遷移先は担当 A のエディタ（src/app/page.tsx）。`map` クエリで対象を指定する。
    if (id !== null) router.push(editorHref(id));
  }, [create, router]);

  const handleRename = useCallback(
    async (id: ID, title: string) => {
      setEditingId(null);
      await rename(id, title);
    },
    [rename],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    await remove(target.id, target.title);
  }, [deleteTarget, remove]);

  const rows = maps === null ? null : visibleMaps(maps, query);

  return (
    <AppShell
      header={
        <AppHeader
          title="Web MindMap"
          onMenuClick={() => setSidebarOpen((open) => !open)}
          menuExpanded={sidebarOpen}
        />
      }
      sidebar={
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          heading="Menu"
          label="メインナビゲーション"
        >
          <nav className={styles.nav} aria-label="画面">
            <Link className={styles.navLink} href="/maps" aria-current="page">
              マップ一覧
            </Link>
            <Link className={styles.navLink} href="/">
              エディタを開く
            </Link>
            <Link className={styles.navLink} href="/settings">
              設定
            </Link>
          </nav>
        </Sidebar>
      }
    >
      <div className={styles.head}>
        <h1 className={styles.title}>マップ</h1>
        <span className={styles.count}>{countLabel(rows, maps, query)}</span>
        <Input
          className={styles.search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="検索"
          aria-label="マップをタイトルで検索"
          aria-controls="map-list"
          icon={<Icon name="search" size={14} />}
        />
        <Button
          variant="primary"
          onClick={() => void handleCreate()}
          loading={creating}
          startIcon={<Icon name="plus" size={14} />}
        >
          新しいマップ
        </Button>
      </div>

      {errorMessage !== null && (
        <p role="alert" className={styles.notice}>
          {errorMessage}
        </p>
      )}

      {/* クラウド同期。ゲスト（userId === null）では通信も描画も起きない。
          同期でローカルが動いたときだけ一覧を読み直す。 */}
      <SyncRunner userId={userId} onLocalChanged={reload} />

      {rows === null ? (
        errorMessage === null && <p className={styles.empty}>読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>{emptyMessage(maps, query)}</p>
      ) : (
        <ul className={styles.list} id="map-list">
          {rows.map((map, index) => (
            <MapRow
              key={map.id}
              map={map}
              index={index}
              now={now}
              signedIn={signedIn}
              editing={editingId === map.id}
              onStartRename={() => setEditingId(map.id)}
              onCancelRename={() => setEditingId(null)}
              onSubmitRename={(title) => void handleRename(map.id, title)}
              onRequestDelete={() => setDeleteTarget({ id: map.id, title: map.title })}
            />
          ))}
        </ul>
      )}

      {deleted !== null && (
        <div role="status" className={styles.undo}>
          <span className={styles.undoText}>「{deleted.title}」を削除しました。</span>
          <Button variant="secondary" size="sm" onClick={() => void undoRemove()}>
            元に戻す
          </Button>
          <Button variant="ghost" size="sm" onClick={dismissRemove}>
            閉じる
          </Button>
        </div>
      )}

      {/* 広告帯（無料プランのみ）。エディタには出さない（CLAUDE.md §15）。
          一覧の行の間には挟まないこと — 検索とスクロールの邪魔になる。 */}
      <AdSlot slot="map-list" signedIn={signedIn} />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="マップを削除しますか？"
        size="sm"
        hideCloseButton
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button variant="danger" onClick={() => void handleConfirmDelete()}>
              削除する
            </Button>
          </>
        }
      >
        <p className={styles.confirmText}>
          「{deleteTarget?.title}」を一覧から削除します。中身はすぐには消えないので、
          このあとしばらくは取り消せます。
        </p>
      </Modal>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// 1行
// ---------------------------------------------------------------------------

interface MapRowProps {
  map: MindMapSummary;
  index: number;
  /** マウント前は null。null のあいだは相対日時を描かない。 */
  now: Date | null;
  signedIn: boolean;
  editing: boolean;
  onStartRename: () => void;
  onCancelRename: () => void;
  onSubmitRename: (title: string) => void;
  onRequestDelete: () => void;
}

function MapRow({
  map,
  index,
  now,
  signedIn,
  editing,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onRequestDelete,
}: MapRowProps) {
  const sync = describeSyncState(map.syncState, signedIn);

  return (
    <li className={styles.row}>
      <span className={styles.rowIndex} aria-hidden="true">
        {formatIndex(index)}
      </span>

      {editing ? (
        <RenameForm initialTitle={map.title} onSubmit={onSubmitRename} onCancel={onCancelRename} />
      ) : (
        <Link className={styles.open} href={editorHref(map.id)}>
          {map.title}
        </Link>
      )}

      <span className={styles.meta}>
        {now !== null && formatRelativeTime(map.updatedAt, now)}
        {sync !== null && (
          <>
            {" · "}
            <span className={sync.tone === "danger" ? styles.metaDanger : undefined}>
              {sync.label}
            </span>
          </>
        )}
      </span>

      {!editing && (
        <span className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onStartRename}>
            名前を変更
          </Button>
          {/* 行の削除ボタンは削除そのものではなく確認 Modal を開くだけなので ghost。
              実際に破壊する Modal の「削除する」だけを danger にしている。
              全行に塗りボタンを並べると一覧が騒がしくなる（CLAUDE.md §17）。 */}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={`「${map.title}」を削除`}
            onClick={onRequestDelete}
          >
            <Icon name="trash" size={14} />
          </Button>
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// 名前変更（インライン編集）
// ---------------------------------------------------------------------------

function RenameForm({
  initialTitle,
  onSubmit,
  onCancel,
}: {
  initialTitle: string;
  onSubmit: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  // 編集に入ったら即打ち始められるようにする（CLAUDE.md §8 の精神）。
  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function submit() {
    const title = value.trim();
    // 空タイトルは保存しない。名前を消したい意図とは考えにくく、
    // 一覧で行を見失う原因になるため、その場合は編集をやめるだけにする。
    if (title.length === 0 || title === initialTitle) {
      onCancel();
      return;
    }
    onSubmit(title);
  }

  return (
    <form
      className={styles.renameForm}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Input
        ref={inputRef}
        className={styles.renameField}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        aria-label="マップ名"
      />
      <Button type="submit" variant="primary" size="sm">
        保存
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        キャンセル
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 表示用の小さなヘルパ
// ---------------------------------------------------------------------------

/**
 * エディタへの遷移先。エディタ画面は `src/app/page.tsx` の1つだけで、
 * `map` クエリで対象を指定する。
 *
 * リンクの生成をここ1か所に閉じておくと、遷移先の形が変わっても
 * 呼び出し側に散らばらない。
 */
function editorHref(id: ID): string {
  return `/?map=${encodeURIComponent(id)}`;
}

function countLabel(
  rows: MindMapSummary[] | null,
  maps: MindMapSummary[] | null,
  query: string,
): string {
  if (rows === null || maps === null) return "";
  if (query.trim().length > 0) return `${rows.length} / ${maps.length} 件`;
  return `${maps.length} 件`;
}

function emptyMessage(maps: MindMapSummary[] | null, query: string): string {
  if (query.trim().length > 0) return "一致するマップがありません。検索語を変えてみてください。";
  if (maps !== null && maps.length > 0) return "表示できるマップがありません。";
  return "まだマップがありません。「新しいマップ」から始めましょう。";
}
