"use client";

/**
 * マップ一覧の状態とリポジトリ操作。
 *
 * ローカル永続化は `@/lib/db` の `getRepository()` 経由でのみ触る。
 * IndexedDB を直接開かない（`src/lib/db/README.md` のルール）。
 * IndexedDB はブラウザ API なので、呼び出しはすべてマウント後に行う。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getRepository } from "@/lib/db";
import { track } from "@/features/telemetry";
import type { ID, MindMapSummary } from "@/lib/model/types";
import { describeMapsError, type MapsOperation } from "./format";

/** 削除の取り消しを受け付ける時間。長すぎると画面に居座るので数秒に留める。 */
export const UNDO_WINDOW_MS = 8000;

export interface DeletedMapNotice {
  id: ID;
  title: string;
}

export interface MapListController {
  /** null は「まだ読み込んでいない」。空配列は「0件」。この2つを混同しない。 */
  maps: MindMapSummary[] | null;
  /** 画面に出す短い日本語のエラー。スタックトレースは含まない。 */
  errorMessage: string | null;
  /** 直前に削除したマップ。取り消しトーストの表示に使う。 */
  deleted: DeletedMapNotice | null;
  reload: () => void;
  create: () => Promise<ID | null>;
  rename: (id: ID, title: string) => Promise<void>;
  remove: (id: ID, title: string) => Promise<void>;
  undoRemove: () => Promise<void>;
  dismissRemove: () => void;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function useMapList(): MapListController {
  const [maps, setMaps] = useState<MindMapSummary[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<DeletedMapNotice | null>(null);

  const alive = useRef(true);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    };
  }, []);

  /** 失敗を握りつぶさずに画面へ出す（CLAUDE.md §29）。診断用に生の例外は console へ。 */
  const report = useCallback((error: unknown, operation: MapsOperation) => {
    const normalized = toError(error);
    console.error(`[maps] ${operation} に失敗しました`, normalized);
    if (alive.current) setErrorMessage(describeMapsError(normalized, operation));
  }, []);

  /**
   * 一覧を読み直す。更新系のあとは必ずこれを通し、
   * 画面の配列ではなく保存済みデータを唯一の正とする。
   */
  const reload = useCallback(() => {
    void getRepository()
      .listMaps()
      .then((next) => {
        if (!alive.current) return;
        setMaps(next);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        report(error, "load");
        // 読めなかったときに空配列を入れると「0件です」と嘘をつくことになる。
        if (alive.current) setMaps(null);
      });
  }, [report]);

  useEffect(reload, [reload]);

  const create = useCallback(async (): Promise<ID | null> => {
    try {
      const doc = await getRepository().createMap();
      // 保存が済んでから数える。失敗したものを「作られた」ことにしない。
      track("map_created");
      reload();
      return doc.map.id;
    } catch (error) {
      report(error, "create");
      return null;
    }
  }, [reload, report]);

  const rename = useCallback(
    async (id: ID, title: string): Promise<void> => {
      try {
        await getRepository().renameMap(id, title);
        reload();
      } catch (error) {
        report(error, "rename");
      }
    },
    [reload, report],
  );

  const dismissRemove = useCallback(() => {
    if (undoTimer.current !== null) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setDeleted(null);
  }, []);

  /**
   * 論理削除のみ。`deleteMap()` は `deletedAt` を立てるだけで中身は残るので、
   * 一定時間内なら `restoreMap()` で元に戻せる（CLAUDE.md §6）。
   * ブラウザの確認ダイアログは使わない（キーボード操作と自動テストを妨げるため）。
   */
  const remove = useCallback(
    async (id: ID, title: string): Promise<void> => {
      try {
        await getRepository().deleteMap(id);
        if (!alive.current) return;
        if (undoTimer.current !== null) clearTimeout(undoTimer.current);
        setDeleted({ id, title });
        undoTimer.current = setTimeout(() => {
          undoTimer.current = null;
          if (alive.current) setDeleted(null);
        }, UNDO_WINDOW_MS);
        reload();
      } catch (error) {
        report(error, "delete");
      }
    },
    [reload, report],
  );

  const undoRemove = useCallback(async (): Promise<void> => {
    if (!deleted) return;
    const target = deleted;
    dismissRemove();
    try {
      await getRepository().restoreMap(target.id);
      reload();
    } catch (error) {
      report(error, "restore");
    }
  }, [deleted, dismissRemove, reload, report]);

  return {
    maps,
    errorMessage,
    deleted,
    reload,
    create,
    rename,
    remove,
    undoRemove,
    dismissRemove,
  };
}
