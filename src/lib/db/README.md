# src/lib/db — ローカル永続化

- `types.ts` … 公開 API の契約（`MapRepository`）。**担当 A が所有。変更は担当 A に依頼すること。**
- `indexeddb.ts` … IndexedDB 実装（`idb` を使用）
- `index.ts` … 利用側の入口。`getRepository()` を使う。

## 使い方

```ts
import { getRepository } from "@/lib/db";

const repo = getRepository();
const maps = await repo.listMaps();
```

## ルール

- 画面・機能から `indexedDB.open()` を直接呼ばない。
- 保存は必ずマップ単位で原子的に行う（部分保存を作らない）。
- スキーマを変えるときは `src/lib/model/types.ts` の `SCHEMA_VERSION` を上げ、
  **既存データを消さない**マイグレーションを書く（CLAUDE.md §6）。
