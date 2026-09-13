import { render, screen, act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNow } from "@/features/maps/useNow";

function Probe() {
  const now = useNow();
  return <span data-testid="probe">{now === null ? "（時刻なし）" : now.toISOString()}</span>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("サーバ描画では時刻を持たない（クライアントとの食い違いが起きない）", () => {
    expect(renderToString(<Probe />)).toContain("（時刻なし）");
  });

  it("マウント後は現在時刻が入る", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).not.toHaveTextContent("（時刻なし）");
  });

  it("1分ごとに更新される", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));

    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-09-13T12:00:00.000Z");

    // advanceTimersByTime は偽の時計そのものを進めるので、
    // setSystemTime を重ねて呼ぶ必要はない。
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("2026-09-13T12:01:00.000Z");
  });

  it("同じ時刻のあいだは同じ参照を返す（再描画が止まらなくならない）", () => {
    vi.useFakeTimers();
    const seen: Array<Date | null> = [];
    function Collector() {
      seen.push(useNow());
      return null;
    }
    const view = render(<Collector />);
    view.rerender(<Collector />);

    const values = seen.filter((value): value is Date => value !== null);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(1);
  });
});
