import type { ID, MindMapDocument, MindMapSummary, SyncMeta } from "@/lib/model/types";

/**
 * ローカル永続化の公開 API（契約）。
 *
 * 画面・機能側は必ずこのインターフェース経由でアクセスし、
 * IndexedDB を直接開いてはいけません（CLAUDE.md §38「結合しない」）。
 * 実装は `src/lib/db/indexeddb.ts`、入口は `src/lib/db/index.ts`。
 */
export interface MapRepository {
  /**
   * マップ一覧を updatedAt の降順で返す。ノードは読み込まない。
   * 既定では論理削除済みを除く。`includeDeleted` を立てると墓標も含める
   * （クラウド同期がサーバ側の削除と突き合わせるために使う）。
   */
  listMaps(options?: { includeDeleted?: boolean }): Promise<MindMapSummary[]>;

  /** タイトルの部分一致検索（大文字小文字を区別しない）。 */
  searchMaps(query: string): Promise<MindMapSummary[]>;

  /**
   * 1件読み込む。存在しない／論理削除済みなら null。
   * `includeDeleted` を立てると論理削除済みでも中身を返す。
   */
  getMap(id: ID, options?: { includeDeleted?: boolean }): Promise<MindMapDocument | null>;

  /**
   * マップ全体を上書き保存する（原子的）。
   * version と updatedAt は実装側が進める。呼び出し側で加算しないこと。
   */
  saveMap(doc: MindMapDocument): Promise<MindMapDocument>;

  /**
   * サーバから取得した内容をそのまま書き込む（クラウド同期専用）。
   *
   * `saveMap` と違い、`version` も `updatedAt` も実装側で進めない。
   * サーバが確定した値をそのまま正とするため、同期側が持つ
   * `lastSyncedVersion` と保存結果がずれない。
   *
   * `options.expectedLocalVersion` は「順序の比較」ではなく
   * **スナップショット一致の確認**である。同期エンジンが判断材料を読んでから
   * 書き込むまでの間にローカルが変化していないことを確かめるためのもので、
   * 食い違えば `StaleWriteError` を投げて何も書かずに中断する。
   * - 数値 … 書き込み前の既存レコードの version がその値であること
   * - `null` … ローカルにレコードが存在しないこと
   *
   * `options` を省略した場合は無条件に書き込む。
   * **その場合は、呼び出し側が ADR-005 の判断表に従って競合を解決済みであることを
   * 前提とする。通常は `expectedLocalVersion` を渡すこと。**
   */
  saveMapFromServer(
    doc: MindMapDocument,
    options?: { expectedLocalVersion?: number | null },
  ): Promise<MindMapDocument>;

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

  /**
   * マップ1件の所有者を設定する。
   * 内容は変わらないので `version` も `updatedAt` も進めない
   * （進めると同期に不要な差分が出るため）。
   */
  claimMap(mapId: ID, userId: ID): Promise<void>;
}
