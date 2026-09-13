/**
 * Web MindMap の共有データモデル。
 *
 * このファイルはエディタ・永続化・クラウド同期のすべてが依存する「契約」です。
 * 破壊的に変更すると IndexedDB に入っている既存データが読めなくなるため、
 * 変更時は必ず `SCHEMA_VERSION` を上げてマイグレーションを書いてください
 * （CLAUDE.md §6 データ安全ルール）。
 */

/** ID は crypto.randomUUID() で生成する。マップ・ノードとも作成後は不変。 */
export type ID = string;

/** ISO 8601（UTC、ミリ秒つき）の日時文字列。例: "2026-09-13T05:00:00.000Z" */
export type ISODateString = string;

/**
 * ローカルに保存されるドキュメントのスキーマ版。
 * MindMapDocument の形を変えたら必ず +1 する。
 */
export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// ノード
// ---------------------------------------------------------------------------

export interface MindMapNode {
  id: ID;
  /** 所属するマップ。 */
  mapId: ID;
  /** 親ノード。null はルート（1マップに1つ）。 */
  parentId: ID | null;
  text: string;
  /** キャンバス座標。自動レイアウトの結果もここに保存する。 */
  x: number;
  y: number;
  /** true のとき子孫を描画しない（データは保持する）。 */
  collapsed: boolean;
  /** 同じ親を持つ兄弟のなかでの並び順（昇順）。連番である必要はない。 */
  order: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ---------------------------------------------------------------------------
// マップ
// ---------------------------------------------------------------------------

export interface MindMap {
  id: ID;
  /** null はゲストのマップ（ローカルのみ）。ログイン時にユーザーへ紐づける。 */
  userId: ID | null;
  title: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  /** 論理削除。null 以外なら一覧に出さない。物理削除は同期完了後に行う。 */
  deletedAt: ISODateString | null;
  /**
   * 単調増加する版番号。ローカルで内容を変更するたびに +1 する。
   * クラウド同期の競合判定に使う（CLAUDE.md §13）。
   */
  version: number;
}

/**
 * 保存・読み込みの単位。マップ1件とそのノード全件をひとまとまりで扱う。
 *
 * 【設計判断】ノードを1レコードずつ持たず、マップ単位の1レコードにする。
 * Phase 1 の上限は1マップ 500〜1000 ノードで、丸ごと読み書きしても
 * 十分に速い。保存が1トランザクションで原子的に終わるため、
 * 「ノードだけ保存されて親子関係が壊れる」事故が構造的に起きない。
 */
export interface MindMapDocument {
  schemaVersion: number;
  map: MindMap;
  nodes: MindMapNode[];
}

/** 一覧画面が必要とする最小限の情報（ノードを読み込まない）。 */
export interface MindMapSummary {
  id: ID;
  title: string;
  updatedAt: ISODateString;
  createdAt: ISODateString;
  nodeCount: number;
  syncState: SyncState;
}

// ---------------------------------------------------------------------------
// 同期
// ---------------------------------------------------------------------------

export type SyncState =
  /** クラウドに存在しない（ゲスト、または未アップロード）。 */
  | "local-only"
  /** ローカルとクラウドが一致している。 */
  | "synced"
  /** ローカルに未送信の変更がある。 */
  | "pending"
  /** 直近の同期に失敗した。ローカルデータは無傷。 */
  | "failed";

export interface SyncMeta {
  mapId: ID;
  state: SyncState;
  /** 最後に同期に成功した時刻。未同期なら null。 */
  lastSyncedAt: ISODateString | null;
  /** 最後に同期に成功したときの MindMap.version。 */
  lastSyncedVersion: number | null;
  /** 直近の失敗理由（UI 表示用の短い文言。スタックトレースは入れない）。 */
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// ユーザー
// ---------------------------------------------------------------------------

export interface User {
  id: ID;
  email: string;
  name: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
