/**
 * クラウド同期の入口。
 *
 * 利用側はこのモジュールだけを import する。
 * 判断表の根拠は `docs/adr/ADR-005-sync-conflict.md`。
 */
export { decideSyncAction, decideGuestMigrationAction } from "./decide";
export type { SyncAction, SyncReason } from "./decide";
export { syncAll, migrateGuestMaps } from "./engine";
export type { SyncConflict, SyncEvent, SyncFailure, SyncOptions, SyncSummary } from "./engine";
export { createLocalStore } from "./local-store-adapter";
export type { CreateLocalStoreOptions } from "./local-store-adapter";
export { createRemoteClient } from "./remote-client";
export type { CreateRemoteClientOptions } from "./remote-client";
export { SyncRunner, type SyncRunnerProps } from "./SyncRunner";
export { useSyncRunner, MIN_SYNC_INTERVAL_MS } from "./useSyncRunner";
export type { SyncRunnerState, UseSyncRunnerOptions } from "./useSyncRunner";
export { describeConflicts, describeSyncPhase } from "./status";
export type { SyncPhase, SyncStatusLabel } from "./status";
export {
  hasUnseenRemoteChanges,
  hasUnsentLocalChanges,
  isRetryable,
  isStaleWriteError,
} from "./types";
export type {
  LocalMapRecord,
  LocalStore,
  RemoteClient,
  RemoteFailureKind,
  RemoteResult,
} from "./types";
export type { MapSummary, SyncMap, SyncNode } from "./protocol";
