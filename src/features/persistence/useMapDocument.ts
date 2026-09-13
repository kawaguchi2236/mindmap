"use client";

/**
 * マップ1件の読み込み＋オートセーブ。
 * エディタ側はこのフックの `doc` / `setDoc` だけを使えばよい。
 */

import { useCallback, useEffect, useState } from "react";
import { track } from "@/features/telemetry";
import { getRepository } from "@/lib/db";
import { toError } from "@/lib/db/errors";
import type { MindMapDocument } from "@/lib/model/types";
import { useAutosave, type SaveStatus } from "./useAutosave";

export interface UseMapDocumentResult {
  doc: MindMapDocument | null;
  setDoc: (doc: MindMapDocument) => void;
  status: SaveStatus;
  loading: boolean;
  /** 読み込みエラー、または直近の保存エラー。 */
  error: Error | null;
  lastSavedAt: Date | null;
  /** 即時保存（画面遷移前など）。 */
  flush: () => Promise<void>;
}

/**
 * 読み込み結果は「どの mapId のものか」とセットで1つの state に持つ。
 * こうすると mapId が変わった瞬間の doc / loading / error は render 時に
 * 導出できるので、effect の中で同期的に setState する必要がなくなる。
 */
interface LoadedState {
  forMapId: string | null;
  doc: MindMapDocument | null;
  error: Error | null;
}

const EMPTY: LoadedState = { forMapId: null, doc: null, error: null };

export function useMapDocument(mapId: string | null): UseMapDocumentResult {
  const [loaded, setLoaded] = useState<LoadedState>(EMPTY);

  useEffect(() => {
    // mapId が null のときは何もしない。表示に必要な状態は下で導出する。
    if (mapId === null) return;

    let cancelled = false;

    getRepository()
      .getMap(mapId)
      .then((document) => {
        if (cancelled) return;
        if (document) track("map_opened", { nodeCount: document.nodes.length });
        setLoaded({ forMapId: mapId, doc: document, error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        const normalized = toError(caught);
        console.error(`[persistence] マップ ${mapId} の読み込みに失敗しました`, normalized);
        setLoaded({ forMapId: mapId, doc: null, error: normalized });
      });

    return () => {
      cancelled = true;
    };
  }, [mapId]);

  // 現在の mapId に対する結果が揃っているか。揃うまでは読み込み中として扱う。
  const resolved = loaded.forMapId === mapId;
  const doc = resolved ? loaded.doc : null;
  const loading = mapId !== null && !resolved;
  const loadError = resolved ? loaded.error : null;

  const { status, lastSavedAt, error: saveError, flush } = useAutosave(doc);

  const setDoc = useCallback((next: MindMapDocument) => {
    setLoaded({ forMapId: next.map.id, doc: next, error: null });
  }, []);

  return {
    doc,
    setDoc,
    status,
    loading,
    error: loadError ?? saveError,
    lastSavedAt,
    flush,
  };
}
