"use client";

/**
 * 同期を「いつ回すか」だけを受け持つフック。
 *
 * 何をどう同期するかは `engine.ts`（判断表は ADR-005）が全部持っている。
 * ここが決めるのは起動条件と多重起動の防止だけで、判断ロジックは一切持たない。
 *
 * 守る約束:
 *   - **ログイン中だけ動く。** ゲストでは `RemoteClient` すら作らず、通信は 1 回も起きない。
 *   - **編集をブロックしない**（CLAUDE.md §5）。すべて背景で走らせ、失敗は状態に落とすだけ。
 *   - **オフライン中は走らせない**（CLAUDE.md §12）。`online` イベントが来ても
 *     `navigator.onLine` が false なら通信しない。合成イベントでは接続は戻らない。
 *   - **アンマウント後に状態を触らない。** タイマーもリスナも必ず解除する。
 */

import { useEffect, useRef, useState } from "react";
import { getRepository } from "@/lib/db";
import { migrateGuestMaps, syncAll, type SyncSummary } from "./engine";
import { createLocalStore } from "./local-store-adapter";
import { createRemoteClient } from "./remote-client";
import type { SyncPhase } from "./status";
import type { LocalStore, RemoteClient } from "./types";

/**
 * ポーリング間隔の下限。これより短い値を渡されても切り上げる。
 *
 * 同期はユーザー操作の裏で走るので、短い周期は Neon の実行時間と
 * バッテリーを削るだけで体感は変わらない。ローカル保存が先に済んでいる以上、
 * クラウドが数十秒遅れても困らない（CLAUDE.md §5）。
 */
export const MIN_SYNC_INTERVAL_MS = 60_000;

export interface SyncRunnerState {
  phase: SyncPhase;
  /** ブラウザがオンラインだと思っているか。 */
  online: boolean;
  /** 直近の同期で作られた競合コピーの件数（ADR-005 §3.2 #10）。 */
  conflictCount: number;
}

export interface UseSyncRunnerOptions {
  /** ログイン中のユーザー ID。ゲストは null で、そのときは何もしない。 */
  userId: string | null;
  /** ポーリング間隔。`MIN_SYNC_INTERVAL_MS` 未満は切り上げられる。 */
  intervalMs?: number;
  /**
   * ローカルの中身が同期で変わったときに呼ばれる。一覧の再読み込みなどに使う。
   * 毎レンダーで作り直しても副作用が再起動しないよう、ref 経由で読む。
   */
  onLocalChanged?: () => void;
  /** テスト用の差し替え口。本番では渡さない（既定の実装が使われる）。 */
  local?: LocalStore;
  remote?: RemoteClient;
}

const INITIAL: SyncRunnerState = { phase: "idle", online: true, conflictCount: 0 };

export function useSyncRunner(options: UseSyncRunnerOptions): SyncRunnerState {
  const { userId, intervalMs, local, remote, onLocalChanged } = options;

  /*
   * 初期値の online を navigator から読まないのは、サーバ描画と
   * クライアント初回描画を一致させるため。実際の値はマウント後に確定する。
   */
  const [state, setState] = useState<SyncRunnerState>(INITIAL);

  const changedRef = useRef(onLocalChanged);
  useEffect(() => {
    changedRef.current = onLocalChanged;
  }, [onLocalChanged]);

  /** アンマウント後に setState しないための番人。 */
  const aliveRef = useRef(false);
  /** 多重起動の防止。前回が終わるまで次を走らせない。 */
  const runningRef = useRef(false);
  /** ゲスト移行を済ませたユーザー ID。「未ログイン → ログイン中」の 1 回だけ走らせる。 */
  const migratedForRef = useRef<string | null>(null);
  /** 既定のポートは 1 度だけ作る（IndexedDB 接続を毎回開き直さない）。 */
  const portsRef = useRef<{ local: LocalStore; remote: RemoteClient } | null>(null);

  useEffect(() => {
    // ゲストは同期しない。ここで返るので fetch も IndexedDB 接続も起きない。
    if (userId === null) return;
    // 以降は必ずログイン中。入れ子の関数でも null でないことを保ったまま使う。
    const signedInUserId: string = userId;

    aliveRef.current = true;
    const period = Math.max(intervalMs ?? MIN_SYNC_INTERVAL_MS, MIN_SYNC_INTERVAL_MS);

    function ports(): { local: LocalStore; remote: RemoteClient } {
      if (local && remote) return { local, remote };
      portsRef.current ??= {
        local: createLocalStore(getRepository()),
        remote: createRemoteClient(),
      };
      return { local: local ?? portsRef.current.local, remote: remote ?? portsRef.current.remote };
    }

    function apply(summary: SyncSummary): void {
      const failed = summary.abortedReason !== undefined || summary.failed.length > 0;
      setState({
        phase: failed ? "failed" : "synced",
        online: true,
        conflictCount: summary.conflicts.length,
      });
      // 一覧の表示（同期状態バッジ・引き込んだマップ）が古くなった場合だけ知らせる。
      if (touchedLocal(summary)) changedRef.current?.();
    }

    async function run(): Promise<void> {
      // 多重起動ガード。周期・再接続・マウントが重なっても同時には 1 本だけ。
      if (runningRef.current) return;
      if (!isOnline()) {
        setState((prev) => ({ ...prev, online: false, phase: "offline" }));
        return;
      }

      runningRef.current = true;
      setState((prev) => ({ ...prev, online: true, phase: "syncing" }));
      try {
        const { local: store, remote: client } = ports();

        if (migratedForRef.current !== signedInUserId) {
          /*
           * 初回ログインのゲストマップ引き継ぎ（ADR-005 §3.4）。
           * 成功したときだけ「済み」にする。失敗したまま印を付けると、
           * ゲストのままのマップが二度と引き継がれなくなる（CLAUDE.md §6）。
           * ローカルのゲストマップは削除されず、所有者が付くだけ。
           */
          const migrated = await migrateGuestMaps({
            local: store,
            remote: client,
            userId: signedInUserId,
          });
          if (!aliveRef.current) return;
          if (migrated.abortedReason === undefined && migrated.failed.length === 0) {
            migratedForRef.current = signedInUserId;
          }
          if (touchedLocal(migrated)) changedRef.current?.();
        }

        const summary = await syncAll({ local: store, remote: client, userId: signedInUserId });
        if (!aliveRef.current) return;
        apply(summary);
      } catch (error) {
        /*
         * `syncAll` も `migrateGuestMaps` も結果型で失敗を返す約束で、例外は投げない。
         * それでもここで受けるのは、約束が破られたときにアプリごと落とさないため
         * （CLAUDE.md §29）。ローカル編集は何があっても続けられる。
         */
        console.error("[sync] 同期中に予期しない例外が発生しました", error);
        if (aliveRef.current) setState((prev) => ({ ...prev, phase: "failed" }));
      } finally {
        runningRef.current = false;
      }
    }

    function handleOnline(): void {
      // イベントを信用せず navigator を見る。run() の中でもう一度確認している。
      void run();
    }

    function handleOffline(): void {
      setState((prev) => ({ ...prev, online: false, phase: "offline" }));
    }

    void run();
    const timer = setInterval(() => void run(), period);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      aliveRef.current = false;
      clearInterval(timer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [userId, intervalMs, local, remote]);

  return state;
}

/** ローカルの保存内容が動いたか（＝画面の再読み込みが要るか）。 */
function touchedLocal(summary: SyncSummary): boolean {
  return (
    summary.pushed.length > 0 ||
    summary.pulled.length > 0 ||
    summary.pushedDeletes.length > 0 ||
    summary.appliedDeletes.length > 0 ||
    summary.restored.length > 0 ||
    summary.conflicts.length > 0
  );
}

/**
 * 通信してよい状態か。
 *
 * `navigator.onLine` が false のときは確実にオフライン。true でも
 * 実際に届くとは限らないが、そちらは `RemoteClient` が network 失敗として扱う。
 */
function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}
