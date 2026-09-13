import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Cloudflare Workers 向けのビルド設定（ADR-001）。
 *
 * Phase 1 はキャッシュ機構を足さない。エディタはクライアント側で完結し、
 * サーバーは認証と同期 JSON API だけを担うため、ISR / incremental cache を
 * 使う経路が無い。必要になってから R2 などを足す（CLAUDE.md §37）。
 */
export default defineCloudflareConfig();
