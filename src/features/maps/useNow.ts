"use client";

/**
 * 「3分前」のような相対表記を実時間に追従させるための時計。
 *
 * `useState` + `useEffect` で現在時刻を入れると、
 * (1) 効果の中で同期的に setState することになり不要な再描画が連鎖する、
 * (2) サーバ描画とクライアント描画で時刻が食い違いハイドレーション不一致になる、
 * の2つを両方踏む。外部ストアとして購読すれば、サーバ描画では常に null、
 * クライアントではマウント後に確定、という形に自然に収まる。
 */

import { useSyncExternalStore } from "react";

/** 更新間隔。分単位の表示しかしないので1分で十分。 */
const TICK_MS = 60_000;

let snapshot: Date | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    snapshot = new Date();
    timer = setInterval(() => {
      snapshot = new Date();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      // 購読者がいなくなったら時刻も捨てる。残したままだと次のマウントの
      // 初回描画で古い時刻が返り、サーバ描画（常に null）と食い違う。
      snapshot = null;
    }
  };
}

/** 同じ値のあいだは同じ参照を返すこと（毎回 new Date() すると再描画が止まらない）。 */
function getSnapshot(): Date | null {
  return snapshot;
}

/** サーバでは時刻を持たない。相対表記は描かれず、不一致も起きない。 */
function getServerSnapshot(): Date | null {
  return null;
}

/**
 * 現在時刻。マウント前（サーバ描画・ハイドレーション時）は null。
 * null のあいだは相対日時を描画しないこと。
 */
export function useNow(): Date | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
