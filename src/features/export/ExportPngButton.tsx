"use client";

/**
 * キャンバスのクロームに挿す PNG 書き出しボタン。
 *
 * `useReactFlow()` を使うので **必ず `<ReactFlowProvider>` の内側**（=
 * `<ReactFlow>` の子）に置くこと。見た目は置き場所側が決める（`className` を
 * 渡すとそのクラスが付く）。エディタの右上では、隣の「元に戻す」などと同じ
 * 文字だけのアクションになる（design/ハンドオフ.md `#2b`）。
 *
 * 書き出しに失敗してもエディタは止めない。メッセージを出し、同じボタンを
 * もう一度押せば再試行できる（CLAUDE.md §29）。
 */
import { useReactFlow } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Button } from "@/components/ui";
import { track } from "@/features/telemetry";
import { exportMapToPng, findViewportElement } from "./exportPng";
import { formatScale } from "./geometry";
import styles from "./ExportPngButton.module.css";

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

export interface ExportPngButtonProps {
  /** マップのタイトル。ファイル名に使う。空でも壊れない。 */
  title: string | null | undefined;
  /** 置き場所側の見た目を当てるためのクラス。 */
  className?: string;
}

export function ExportPngButton({ title, className }: ExportPngButtonProps): ReactElement {
  const { getNodes, getNodesBounds } = useReactFlow();
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // 書き出し中にマップを閉じられたときに、消えたコンポーネントを更新しない。
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClick = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      // await をまたぐと currentTarget が null になるので先に取っておく。
      const viewport = findViewportElement(event.currentTarget);
      setStatus({ kind: "working" });

      // getNodes() は表示中のノードだけ。折りたたんだ子孫は入らない（ADR-006）。
      const nodes = getNodes();
      const result = await exportMapToPng({
        viewport,
        bounds: getNodesBounds(nodes),
        title,
      });

      if (!mountedRef.current) return;
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      // 成功したときだけ数える。送るのは件数と縮小したかだけで、マップの中身は送らない。
      track("png_exported", { nodeCount: nodes.length, scaled: result.scale < 1 });
      setStatus(
        result.scale < 1
          ? {
              kind: "done",
              message: `大きいため ${formatScale(result.scale)} に縮小して書き出しました。`,
            }
          : { kind: "idle" },
      );
    },
    [getNodes, getNodesBounds, title],
  );

  const message = status.kind === "done" || status.kind === "error" ? status.message : null;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={className}
        onClick={handleClick}
        loading={status.kind === "working"}
        aria-label="マップを PNG で書き出す"
      >
        PNG
      </Button>
      {message !== null && (
        <span
          className={`${styles.status} ${status.kind === "error" ? styles.error : ""}`.trim()}
          role={status.kind === "error" ? "alert" : "status"}
        >
          {message}
        </span>
      )}
    </>
  );
}
