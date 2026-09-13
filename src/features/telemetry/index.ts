/** 計測・エラー監視の公開入口。他の機能はここからだけ import する。 */

export type {
  LoginMethod,
  SyncFailureReason,
  TelemetryEnvelope,
  TelemetryEventMap,
  TelemetryEventName,
} from "./events";
export { MAP_EDITED_THROTTLE_MS, track, trackMapEdited } from "./track";
export {
  installGlobalErrorHandlers,
  reportError,
  type ErrorContext,
  type ErrorReport,
} from "./errors";
export { TelemetryBootstrap } from "./TelemetryBootstrap";
