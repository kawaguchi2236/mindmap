"use client";

/**
 * オートセーブ（CLAUDE.md §11）。
 *
 * 方針:
 * - 画面の状態更新は即時。保存はデバウンスして裏で行う。
 * - 保存に失敗しても編集を止めない。status を "error" にするだけで、
 *   例外は呼び出し側に投げない。
 * - 保存中に新しい変更が来たら、保存が終わってから最新の内容でもう一度保存する。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getRepository } from "@/lib/db";
import { StaleWriteError, toError } from "@/lib/db/errors";
import type { MindMapDocument } from "@/lib/model/types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 500;

export interface UseAutosaveOptions {
  debounceMs?: number;
}

export interface UseAutosaveResult {
  status: SaveStatus;
  lastSavedAt: Date | null;
  error: Error | null;
  /** デバウンスを待たずに即時保存する（ページ離脱時など）。例外は投げない。 */
  flush: () => Promise<void>;
}

export function useAutosave(
  doc: MindMapDocument | null,
  options: UseAutosaveOptions = {},
): UseAutosaveResult {
  const debounceMs = options.debounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;

  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  /** 未保存の最新内容。保存が終わるまでここに積む。 */
  const pendingRef = useRef<MindMapDocument | null>(null);
  /** 実行中の保存処理。flush はこれを待つ。 */
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 直近に見たドキュメント。参照が同じなら変更なしとみなす。 */
  const seenRef = useRef<{ mapId: string; doc: MindMapDocument } | null>(null);
  /**
   * 保存済みの version。保存のたびにリポジトリが +1 するので、
   * 画面が持つ doc の version は 1 つ古くなる。そのまま次を保存すると
   * StaleWriteError になるため、送信時にここで補正する。
   */
  const savedVersionRef = useRef<{ mapId: string; version: number } | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 送信直前に version だけ保存済みの値に合わせる。内容は画面のものが正。 */
  const withCurrentVersion = useCallback((target: MindMapDocument): MindMapDocument => {
    const saved = savedVersionRef.current;
    if (!saved || saved.mapId !== target.map.id || saved.version <= target.map.version) {
      return target;
    }
    return { ...target, map: { ...target.map, version: saved.version } };
  }, []);

  const runSave = useCallback(async () => {
    if (inFlightRef.current) return inFlightRef.current;

    const task = (async () => {
      setStatus("saving");
      try {
        // 保存中に届いた変更を取りこぼさないよう、空になるまで繰り返す。
        while (pendingRef.current) {
          const target = pendingRef.current;
          pendingRef.current = null;
          let saved: MindMapDocument;
          try {
            saved = await getRepository().saveMap(withCurrentVersion(target));
          } catch (saveError) {
            if (!(saveError instanceof StaleWriteError)) throw saveError;
            // 他の経路（リネーム・削除など）で version が進んでいた。
            // 内容は編集中の画面のものが最新なので、version を合わせて1度だけやり直す。
            savedVersionRef.current = { mapId: target.map.id, version: saveError.storedVersion };
            saved = await getRepository().saveMap(withCurrentVersion(target));
          }
          savedVersionRef.current = { mapId: saved.map.id, version: saved.map.version };
        }
        setLastSavedAt(new Date());
        setError(null);
        setStatus("saved");
      } catch (caught) {
        // 保存に失敗しても編集は止めない。次の変更で自動的に再挑戦される。
        pendingRef.current = null;
        const normalized = toError(caught);
        console.error("[autosave] ローカル保存に失敗しました", normalized);
        setError(normalized);
        setStatus("error");
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = task;
    return task;
  }, [withCurrentVersion]);

  const flush = useCallback(async () => {
    clearTimer();
    await inFlightRef.current;
    if (pendingRef.current) {
      await runSave();
    }
  }, [clearTimer, runSave]);

  useEffect(() => {
    if (!doc) {
      // マップを閉じた／切り替え中。次に来る doc は「読み込み直後の1件目」として扱う。
      seenRef.current = null;
      return;
    }

    const previous = seenRef.current;
    seenRef.current = { mapId: doc.map.id, doc };

    // 同じ参照＝変更なし。別マップの最初の1件＝読み込み直後なので保存しない。
    if (previous?.doc === doc) return;
    if (!previous || previous.mapId !== doc.map.id) {
      savedVersionRef.current = { mapId: doc.map.id, version: doc.map.version };
      return;
    }

    pendingRef.current = doc;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSave();
    }, debounceMs);
    // debounceMs だけが変わったときは上の「変更なし」判定で早期 return するため、
    // 再スケジュールは起きない。
  }, [doc, debounceMs, clearTimer, runSave]);

  // ページ離脱・バックグラウンド化のタイミングで取りこぼさない。
  useEffect(() => {
    const handleBeforeUnload = () => {
      void flush();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") void flush();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flush]);

  // アンマウント時も未保存分を書き出す。
  useEffect(() => {
    return () => {
      clearTimer();
      if (pendingRef.current) void runSave();
    };
  }, [clearTimer, runSave]);

  return { status, lastSavedAt, error, flush };
}
