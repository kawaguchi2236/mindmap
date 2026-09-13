import { neon, neonConfig, Pool } from "@neondatabase/serverless";

/**
 * Neon PostgreSQL 接続（サーバ専用）。
 *
 * ADR-002（docs/adr/ADR-002-query-layer.md）の決定に従い、ORM は使わず
 * @neondatabase/serverless のタグ付きテンプレート（自動パラメータ化）を使う。
 *
 * このファイルは必ずサーバ側（Route Handler / Server Component / Server Action）
 * からのみ import すること。クライアントに DATABASE_URL を漏らさない。
 */

neonConfig.fetchConnectionCache = true;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL が未設定です。.env.example を参考に .env.local を作成してください。",
    );
  }
  return url;
}

/**
 * 単発クエリ用。HTTP 経由なので Cloudflare Workers でも動く。
 *
 *   const rows = await sql`select id from maps where user_id = ${userId}`;
 */
export const sql = (() => {
  let client: ReturnType<typeof neon> | null = null;
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    client ??= neon(connectionString());
    return client(strings, ...values);
  }) as ReturnType<typeof neon>;
})();

/**
 * トランザクションが必要な処理（マップ本体とノードの一括保存など）用。
 * 使い終わったら必ず release() する。
 */
export function createPool(): Pool {
  return new Pool({ connectionString: connectionString() });
}

/** トランザクションを張って fn を実行する。例外時は自動 ROLLBACK。 */
export async function withTransaction<T>(
  fn: (client: import("@neondatabase/serverless").PoolClient) => Promise<T>,
): Promise<T> {
  const pool = createPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
