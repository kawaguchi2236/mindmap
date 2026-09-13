"use client";

import { useEffect, useState } from "react";

/**
 * 現在のオンライン状態（CLAUDE.md §12）。
 * SSR とハイドレーション不一致を避けるため、初期値は true 固定にして
 * マウント後に実際の値へ合わせる。
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
