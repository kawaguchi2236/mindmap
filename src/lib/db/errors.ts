/**
 * ローカル永続化のエラー型。
 *
 * CLAUDE.md §29: エラーを握りつぶさない。IndexedDB の失敗は
 * 「ローカルデータが危険かもしれない」ことを意味するので必ず表に出す。
 */

/** すべてのローカル永続化エラーの基底。 */
export class LocalStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LocalStoreError";
  }
}

/**
 * IndexedDB が使えない（SSR、プライベートウィンドウ、ストレージ拒否など）。
 * 呼び出し側は「このブラウザではローカル保存できません」と表示すること。
 */
export class IndexedDbUnavailableError extends LocalStoreError {
  constructor(message = "IndexedDB を利用できません。", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "IndexedDbUnavailableError";
  }
}

/**
 * 保存しようとした version が、保存先にある version より古い。
 * 新しいデータを古いデータで潰さないための拒否（CLAUDE.md §6）。
 */
export class StaleWriteError extends LocalStoreError {
  constructor(
    readonly mapId: string,
    readonly incomingVersion: number,
    /** 保存先にある version。レコードが存在しなかった場合は 0（version は 1 始まり）。 */
    readonly storedVersion: number,
    message?: string,
  ) {
    super(
      message ??
        `マップ ${mapId} の保存を拒否しました: 保存しようとした version ${incomingVersion} は ` +
          `保存済みの version ${storedVersion} より古いためです。`,
    );
    // 同期側が error.name === "StaleWriteError" で判定している。変更しないこと。
    this.name = "StaleWriteError";
  }
}

/** 対象のマップが存在しない。 */
export class MapNotFoundError extends LocalStoreError {
  constructor(readonly mapId: string) {
    super(`マップ ${mapId} が見つかりません。`);
    this.name = "MapNotFoundError";
  }
}

/** 保存しようとしたドキュメントの形が壊れている（部分保存の予防）。 */
export class InvalidDocumentError extends LocalStoreError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDocumentError";
  }
}

/**
 * 保存済みデータのスキーマ版が、このアプリが知っている版より新しい。
 * 読み込んで書き戻すとデータを壊すので、触らずに停止する。
 */
export class UnsupportedSchemaVersionError extends LocalStoreError {
  constructor(
    readonly mapId: string,
    readonly storedSchemaVersion: number,
    readonly supportedSchemaVersion: number,
  ) {
    super(
      `マップ ${mapId} は新しいスキーマ版 ${storedSchemaVersion}（このアプリの対応は ` +
        `${supportedSchemaVersion}）で保存されています。アプリを更新してください。`,
    );
    this.name = "UnsupportedSchemaVersionError";
  }
}

/** 未知の例外を Error に正規化する。 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  return new Error(String(value));
}
