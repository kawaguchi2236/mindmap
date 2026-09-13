/**
 * 広告枠（task.md §14 / CLAUDE.md §15）。
 *
 * 置いてよいのはマップ一覧・設定・テンプレート画面だけ。**エディタのキャンバス、
 * マップを開くまでの導線、起動時、ノード作成中、キーボード入力を妨げるモーダル**には
 * 絶対に置かない。この枠は帯（ブロック要素）1つで、キャンバスの作業領域も削らない。
 *
 * 実際の広告ネットワーク（AdSense 等）のスクリプトはまだ読み込まない。事業者登録と
 * 外部送信が必要で、この段階では行えないため。ここが用意するのは「枠」と
 * 「事業者 ID を環境変数から受け取る口」だけ。
 *
 * 色・余白はトークン変数で指定し、ダークモードの分岐は書かない
 * （3状態ぶんのトークンが定義済みなので var() が自動で追従する）。
 */

import { shouldShowAds } from "./plan";
import styles from "./AdSlot.module.css";

export interface AdSlotProps {
  /**
   * どの画面のどの枠か。事業者側の枠設定と対応づけるための識別子で、
   * 同じ事業者 ID の下に複数の枠を置けるようにしている。
   */
  slot: string;
  /** ログイン中かどうか。出す／出さないの判断は `shouldShowAds` に任せる。 */
  signedIn: boolean;
}

/** 広告事業者 ID。未設定なら広告は一切描かない（本番の場合）。 */
function adClient(): string | null {
  // NEXT_PUBLIC_ 付きの参照は静的に解決される必要があるため、変数に畳まないこと。
  const value = process.env.NEXT_PUBLIC_AD_CLIENT;
  return value !== undefined && value.length > 0 ? value : null;
}

export function AdSlot({ slot, signedIn }: AdSlotProps) {
  if (!shouldShowAds(signedIn)) return null;

  const client = adClient();

  if (client === null) {
    /*
     * 事業者 ID が無いのに空の枠や「広告」というラベルだけを出すと、
     * ユーザーからは何も入っていない帯が残るだけで、意味が分からないし誠実でもない。
     * 本番では何も描かない。仮表示はレイアウト確認のための開発時だけに限る。
     */
    if (process.env.NODE_ENV !== "development") return null;

    return (
      <aside
        className={`${styles.slot} ${styles.placeholder}`}
        aria-label="広告枠（開発用の仮表示）"
        data-ad-placeholder="true"
      >
        <span className={styles.label}>広告</span>
        <span className={styles.note}>
          {slot} ／ NEXT_PUBLIC_AD_CLIENT が未設定のため、開発時だけの仮表示
        </span>
      </aside>
    );
  }

  /*
   * 枠そのもの。広告であることが分かるラベルを必ず添え、本文のコンテンツに
   * 見せかけないこと。高さは CSS で先に確保してあるので、あとから中身が入っても
   * 周りの要素が動かない。
   */
  return (
    <aside className={styles.slot} aria-label="広告" data-ad-client={client} data-ad-slot={slot}>
      <span className={styles.label}>広告</span>
    </aside>
  );
}
