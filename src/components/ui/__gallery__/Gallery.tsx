"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "../Button";
import { Icon } from "../Icon";
import type { IconName } from "../Icon";
import { Input } from "../Input";
import { Modal } from "../Modal";
import { Tooltip } from "../Tooltip";
import { ThemeToggle } from "../../theme/ThemeToggle";
import styles from "./Gallery.module.css";

const COLOR_TOKENS = [
  "--color-bg",
  "--color-surface",
  "--color-surface-floating",
  "--color-text",
  "--color-text-secondary",
  "--color-text-disabled",
  "--color-icon",
  "--color-border",
  "--color-border-subtle",
  "--color-border-strong",
  "--color-accent",
  "--color-accent-text",
  "--color-accent-tint",
  "--color-accent-solid",
  "--color-danger",
  "--color-danger-text",
  "--color-danger-tint",
  "--color-danger-solid",
  "--color-focus",
  "--color-edge",
];

const ICON_NAMES: IconName[] = [
  "plus",
  "trash",
  "search",
  "chevron-right",
  "chevron-down",
  "sun",
  "moon",
  "download",
  "settings",
  "recenter",
  "close",
  "check",
  "menu",
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * デザインシステムの目視確認用。製品の画面ではない。
 * ページへの割り当て（ルーティング）は親側で行う。
 */
export function Gallery() {
  const [modalOpen, setModalOpen] = useState(false);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [title, setTitle] = useState("新しいマップ");
  const [email, setEmail] = useState("not-an-email");

  return (
    <div className={styles.gallery}>
      <Section title="Theme / テーマ">
        <ThemeToggle />
        <p className={styles.bodyText}>
          「システム」は OS の設定に追従します。ライト／ダークを選ぶと、その選択が
          この端末に記憶されます。
        </p>
      </Section>

      <Section title="Color / 配色">
        <div className={styles.swatches}>
          {COLOR_TOKENS.map((token) => (
            <div key={token} className={styles.swatch}>
              <div className={styles.chip} style={{ backgroundColor: `var(${token})` }} />
              {token}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Typography / タイポグラフィ">
        <div className={styles.typeSample}>
          <span className={styles.monoLabel}>Section label · セクションラベル</span>
          <div className={styles.display5xl}>マップ</div>
          <div className={styles.display3xl}>ルートノード Root node</div>
          <div className={styles.display2xl}>一覧の項目名 List item</div>
          <p className={styles.bodyText}>
            本文。思考を止めずに書き出すためのマインドマップです。Enter で同階層、Tab
            で子ノードを作れます。
          </p>
        </div>
      </Section>

      <Section title="Button / ボタン">
        <div className={styles.row}>
          <Button variant="primary">新しいマップ</Button>
          <Button variant="secondary">テンプレートから</Button>
          <Button variant="ghost">キャンセル</Button>
          <Button variant="danger">削除する</Button>
        </div>
        <div className={styles.row}>
          <Button variant="primary" size="sm" startIcon={<Icon name="plus" size={14} />}>
            追加
          </Button>
          <Button variant="secondary" size="sm" endIcon={<Icon name="chevron-right" size={14} />}>
            次へ
          </Button>
          <Button variant="primary" loading>
            保存中
          </Button>
          <Button variant="primary" disabled>
            無効
          </Button>
          <Button variant="secondary" disabled>
            無効
          </Button>
        </div>
        <div className={styles.row}>
          <Button variant="secondary" iconOnly aria-label="PNG を書き出す">
            <Icon name="download" size={16} />
          </Button>
          <Button variant="ghost" iconOnly size="sm" aria-label="設定を開く">
            <Icon name="settings" size={14} />
          </Button>
          <Button variant="danger" iconOnly aria-label="マップを削除する">
            <Icon name="trash" size={16} />
          </Button>
          <Button variant="ghost" iconOnly loading aria-label="読み込み中" />
        </div>
      </Section>

      <Section title="Input / 入力">
        <div className={styles.stack}>
          <Input
            label="マップ名"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            hint="あとから変更できます。"
          />
          <Input
            label="メールアドレス"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={email.includes("@") ? undefined : "メールアドレスの形式で入力してください。"}
            required
          />
          <Input
            aria-label="マップを検索"
            placeholder="検索"
            icon={<Icon name="search" size={14} />}
          />
          <Input label="無効な入力" value="編集できません" disabled readOnly />
        </div>
      </Section>

      <Section title="Tooltip / ツールチップ">
        <div className={styles.row}>
          <Tooltip content="キャンバスを中央に戻します（⌘0）">
            <Button variant="ghost" iconOnly aria-label="中央へ戻す">
              <Icon name="recenter" size={16} />
            </Button>
          </Tooltip>
          <Tooltip content="PNG で書き出します（⌘⇧E）" placement="bottom">
            <Button variant="secondary">PNG</Button>
          </Tooltip>
          <Tooltip content="右側に出る例です" placement="right">
            <Button variant="ghost">右</Button>
          </Tooltip>
        </div>
        <p className={styles.bodyText}>
          Tab キーでボタンにフォーカスしても同じ説明が出ます（マウスが無くても読めます）。Esc
          で閉じられます。
        </p>
      </Section>

      <Section title="Modal / モーダル">
        <div className={styles.row}>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>
            通常のダイアログ
          </Button>
          <Button variant="danger" onClick={() => setDangerOpen(true)}>
            削除の確認
          </Button>
        </div>

        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="マップの名前を変更"
          footer={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>
                キャンセル
              </Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>
                保存
              </Button>
            </>
          }
        >
          <Input label="マップ名" defaultValue="新しいマップ" />
        </Modal>

        <Modal
          open={dangerOpen}
          onClose={() => setDangerOpen(false)}
          title="このマップを削除しますか"
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDangerOpen(false)}>
                キャンセル
              </Button>
              <Button variant="danger" onClick={() => setDangerOpen(false)}>
                削除する
              </Button>
            </>
          }
        >
          削除すると元に戻せません。この端末とクラウドの両方から消えます。
        </Modal>
      </Section>

      <Section title="Icon / アイコン">
        <div className={styles.icons}>
          {ICON_NAMES.map((name) => (
            <div key={name} className={styles.iconCell}>
              <Icon name={name} size={20} />
              {name}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
