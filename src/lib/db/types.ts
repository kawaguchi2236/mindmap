import type { ID, MindMapDocument, MindMapSummary, SyncMeta } from "@/lib/model/types";

/**
 * ローカル永続化の公開 API（契約）。
 *
 * 画面・機能側は必ずこのインターフェース経由でアクセスし、
 * IndexedDB を直接開いてはいけません（CLAUDE.md §38「結合しない」）。
 * 実装は `src/lib/db/indexeddb.ts`、入口は `src/lib/db/index.ts`。
 */
export interface MapRepository {
  /** 削除済みを除くマップ一覧を updatedAt の降順で返す。ノードは読み込まない。 */
  listMaps(): Promise<MindMapSummary[]>;

  /** タイトルの部分一致検索（大文字小文字を区別しない）。 */
  searchMaps(query: string): Promise<MindMapSummary[]>;

  /** 1件読み込む。存在しない／論理削除済みなら null。 */
  getMap(id: ID): Promise<MindMapDocument | null>;

  /**
   * マップ全体を上書き保存する（原子的）。
   * version と updatedAt は実装側が進める。呼び出し側で加算しないこと。
   */
  saveMap(doc: MindMapDocument): Promise<MindMapDocument>;

  /** 新規マップを作り、ルートノード1つを入れて保存する。 */
  createMap(title?: string): Promise<MindMapDocument>;

  /** タイトルのみ更新する。 */
  renameMap(id: ID, title: string): Promise<void>;

  /** 論理削除（deletedAt を立てる）。物理削除はしない。 */
  deleteMap(id: ID): Promise<void>;

  /** 論理削除を取り消す。 */
  restoreMap(id: ID): Promise<void>;

  /** 同期メタ情報の取得・更新（担当 B のクラウド同期が使う）。 */
  getSyncMeta(mapId: ID): Promise<SyncMeta | null>;
  setSyncMeta(meta: SyncMeta): Promise<void>;

  /**
   * ゲスト（userId === null）のマップ一覧。
   * ログイン時の引き継ぎで使う。ここでデータを消してはいけない。
   */
  listGuestMaps(): Promise<MindMapSummary[]>;

  /** ゲストマップを指定ユーザーに紐づける（データは保持したまま）。 */
  claimGuestMaps(userId: ID): Promise<ID[]>;
}
