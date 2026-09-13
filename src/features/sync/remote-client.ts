import {
  API_BASE,
  mapSummarySchema,
  syncMapSchema,
  type MapSummary,
  type SyncMap,
} from "./protocol";
import type { RemoteClient, RemoteFailureKind, RemoteResult } from "./types";
import { z } from "zod";

/**
 * `/api/maps` に対する `RemoteClient` 実装。
 *
 * **このモジュールは例外を投げない。** オフライン・タイムアウト・壊れた JSON、
 * すべて `RemoteResult` の失敗として返す。同期の失敗でアプリが落ちてはいけない
 * （CLAUDE.md §29）。エンドポイント仕様は `protocol.ts` 末尾の表を参照。
 */

const summaryListSchema = z.object({ maps: z.array(mapSummarySchema) });
const mapResponseSchema = z.object({ map: syncMapSchema });
const conflictResponseSchema = z.object({
  error: z.literal("conflict"),
  serverMap: syncMapSchema,
});

export interface CreateRemoteClientOptions {
  /** 既定は `/api/maps`。テストや別オリジン運用のために差し替えられる。 */
  baseUrl?: string;
  /** 既定は global の `fetch`。 */
  fetchImpl?: typeof fetch;
  /** 1 リクエストのタイムアウト（ミリ秒）。0 以下で無効。 */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createRemoteClient(options: CreateRemoteClientOptions = {}): RemoteClient {
  const baseUrl = options.baseUrl ?? API_BASE;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // 呼び出し時に解決する。fetch を this に束縛せずに済むよう包む。
  const doFetch: typeof fetch = options.fetchImpl
    ? options.fetchImpl
    : (input, init) => globalThis.fetch(input, init);

  async function request<T>(
    path: string,
    init: RequestInit,
    schema: z.ZodType<T>,
  ): Promise<RemoteResult<T>> {
    let response: Response;
    const controller = timeoutMs > 0 ? new AbortController() : undefined;
    const timer =
      controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        signal: controller?.signal,
        headers: { "content-type": "application/json", ...init.headers },
      });
    } catch (error) {
      // ネットワーク到達不能・中断。どちらも再試行する価値がある。
      return { ok: false, kind: "network", message: describe(error) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (response.status === 409) {
      const body = await readJson(response);
      const parsed = conflictResponseSchema.safeParse(body);
      if (!parsed.success) {
        return { ok: false, kind: "serverError", message: "409 応答の形式が不正です" };
      }
      return { ok: false, kind: "conflict", serverMap: parsed.data.serverMap };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: statusToKind(response.status),
        message: await readErrorMessage(response),
      };
    }

    const body = await readJson(response);
    if (body === undefined) {
      return { ok: false, kind: "serverError", message: "応答の JSON を読めませんでした" };
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // サーバとクライアントの契約がずれている。再試行しても直らない。
      return {
        ok: false,
        kind: "invalidRequest",
        message: "応答が protocol.ts の形式と一致しません",
      };
    }
    return { ok: true, data: parsed.data };
  }

  return {
    async listSummaries(since?: string): Promise<RemoteResult<MapSummary[]>> {
      const query = since ? `?since=${encodeURIComponent(since)}` : "";
      const res = await request(query, { method: "GET" }, summaryListSchema);
      return res.ok ? { ok: true, data: res.data.maps } : res;
    },

    async getMap(id: string): Promise<RemoteResult<SyncMap>> {
      const res = await request(`/${encodeURIComponent(id)}`, { method: "GET" }, mapResponseSchema);
      return res.ok ? { ok: true, data: res.data.map } : res;
    },

    async putMap(map: SyncMap, baseVersion: number): Promise<RemoteResult<SyncMap>> {
      const res = await request(
        `/${encodeURIComponent(map.id)}`,
        { method: "PUT", body: JSON.stringify({ map, baseVersion }) },
        mapResponseSchema,
      );
      return res.ok ? { ok: true, data: res.data.map } : res;
    },

    async deleteMap(id: string, baseVersion: number): Promise<RemoteResult<SyncMap>> {
      const res = await request(
        `/${encodeURIComponent(id)}`,
        { method: "DELETE", body: JSON.stringify({ baseVersion }) },
        mapResponseSchema,
      );
      return res.ok ? { ok: true, data: res.data.map } : res;
    },
  };
}

function statusToKind(status: number): RemoteFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "notFound";
  if (status >= 400 && status < 500) return "invalidRequest";
  return "serverError";
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** サーバのエラー本文。生のスタックトレースは UI に出さない（CLAUDE.md §29）。 */
async function readErrorMessage(response: Response): Promise<string> {
  const body = await readJson(response);
  const parsed = z.object({ error: z.string() }).safeParse(body);
  return parsed.success ? parsed.data.error : `HTTP ${response.status}`;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.name === "AbortError" ? "タイムアウトしました" : error.message;
  }
  return String(error);
}
