-- 適用方法: Neon SQL Editor にこのファイルの内容を貼り付けて実行する。
-- CLI なら `psql "$DATABASE_URL" -f src/lib/server/migrations/001_init.sql`（何度流しても安全）。

-- gen_random_uuid() は PostgreSQL 13 以降の組み込み関数なので Neon では本来不要。
-- 念のため安全側に倒して入れておく（すでに有効なら何も起きない）。
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Auth.js (@auth/neon-adapter) が要求するテーブル
--
-- 列名・大文字小文字は node_modules/@auth/neon-adapter/src/index.ts の SQL に
-- 厳密に合わせている（"userId" / "emailVerified" / "sessionToken" /
-- "providerAccountId" は引用符付きのキャメルケース）。勝手に変えるとアダプタが壊れる。
--
-- 公式ドキュメントのサンプルは id を SERIAL にしているが、ここでは uuid を使う。
-- Auth.js の AdapterUser.id と src/features/auth/session.ts の SessionUser.id が
-- どちらも string であり、maps.user_id との比較で数値／文字列の取り違えを
-- 起こさないようにするため。アダプタは INSERT 時に id を指定しないので、
-- DEFAULT gen_random_uuid() がそのまま効く（PostgreSQL 13+ の組み込み関数）。
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            varchar(255),
  email           varchar(255),
  "emailVerified" timestamptz,
  image           text,
  -- CLAUDE.md §7 の論理モデルに合わせた監査列。アダプタは触らないので DEFAULT 必須。
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 同一メールで別ユーザーが二重に作られるのを防ぐ。
-- PostgreSQL の UNIQUE は NULL を重複扱いしないので、email が未設定でも問題ない。
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS accounts (
  id                  serial PRIMARY KEY,
  "userId"            uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                varchar(255) NOT NULL,
  provider            varchar(255) NOT NULL,
  "providerAccountId" varchar(255) NOT NULL,
  refresh_token       text,
  access_token        text,
  expires_at          bigint,
  id_token            text,
  scope               text,
  session_state       text,
  token_type          text
);

-- 同じプロバイダの同じアカウントが二重に紐づかないようにする。
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_key
  ON accounts (provider, "providerAccountId");
CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts ("userId");

CREATE TABLE IF NOT EXISTS sessions (
  id             serial PRIMARY KEY,
  "userId"       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires        timestamptz NOT NULL,
  "sessionToken" varchar(255) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS sessions_session_token_key
  ON sessions ("sessionToken");
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions ("userId");

CREATE TABLE IF NOT EXISTS verification_token (
  identifier text NOT NULL,
  expires    timestamptz NOT NULL,
  token      text NOT NULL,

  PRIMARY KEY (identifier, token)
);

-- ---------------------------------------------------------------------------
-- アプリ本体（CLAUDE.md §7）
-- ---------------------------------------------------------------------------

-- id はクライアント生成（ローカルとクラウドで同じ ID を使い続ける）。
-- version はサーバだけが進める楽観ロック用カウンタ。
-- deleted_at は論理削除。物理削除はしない（CLAUDE.md §6）。
CREATE TABLE IF NOT EXISTS maps (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  version    integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- 差分同期（GET /api/maps?since=...）の主経路。
CREATE INDEX IF NOT EXISTS maps_user_updated_idx ON maps (user_id, updated_at DESC);

-- ノードはマップ単位で全置換する。主キーを (map_id, id) にしてあるので、
-- 別マップで同じノード ID が使われていても衝突しない。
CREATE TABLE IF NOT EXISTS nodes (
  map_id     text NOT NULL REFERENCES maps (id) ON DELETE CASCADE,
  id         text NOT NULL,
  parent_id  text,
  text       text NOT NULL DEFAULT '' CHECK (char_length(text) <= 10000),
  x          double precision NOT NULL,
  y          double precision NOT NULL,
  collapsed  boolean NOT NULL DEFAULT false,
  "order"    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (map_id, id),

  -- 親子は必ず同じマップの中で閉じる。
  -- 全置換の INSERT は親より先に子が来ることがあるため DEFERRABLE にし、
  -- 整合性は COMMIT 時にまとめて検証させる。
  CONSTRAINT nodes_parent_fkey FOREIGN KEY (map_id, parent_id)
    REFERENCES nodes (map_id, id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,

  -- 自分自身を親にはできない（FK では防げないので CHECK で塞ぐ）。
  CONSTRAINT nodes_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);

-- FK（nodes_parent_fkey）の検証と、親ごとの子取得を支える。
CREATE INDEX IF NOT EXISTS nodes_parent_idx ON nodes (map_id, parent_id);
