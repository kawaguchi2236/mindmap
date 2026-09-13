import { describe, expect, it } from "vitest";
import { decideGuestMigrationAction, decideSyncAction } from "@/features/sync/decide";
import { makeMap, makeRecord, toSummary } from "./helpers";

/**
 * ADR-005 の判断表の全行に 1 テストずつ対応させる。
 * `describe` の見出しが表の節、`it` の見出しが `reason` の値。
 *
 * 表を変更するときは docs/adr/ADR-005-sync-conflict.md → decide.ts → このファイル
 * の 3 点を必ず揃えること。
 */

const DELETED_AT = "2026-09-13T12:00:00.000Z";

describe("ADR-005 §3.1 片側にしか存在しない", () => {
  it("both-absent: どちらにも無ければ何もしない", () => {
    expect(decideSyncAction(undefined, undefined)).toEqual({
      type: "noop",
      reason: "both-absent",
    });
  });

  it("local-only-new: 未同期のローカルマップは baseVersion 0 で push する", () => {
    const local = makeRecord({ syncedVersion: 0, map: { version: 1 } });
    expect(decideSyncAction(local, undefined)).toEqual({
      type: "push",
      reason: "local-only-new",
      baseVersion: 0,
    });
  });

  it("local-only-deleted: サーバに無い削除済みマップは何もしない", () => {
    const local = makeRecord({ syncedVersion: 0, map: { deletedAt: DELETED_AT } });
    expect(decideSyncAction(local, undefined)).toEqual({
      type: "noop",
      reason: "local-only-deleted",
    });
  });

  it("local-only-vanished: 同期済みなのにサーバから消えたマップは push で復活させる", () => {
    const local = makeRecord({ syncedVersion: 5, map: { version: 5 } });
    expect(decideSyncAction(local, undefined)).toEqual({
      type: "push",
      reason: "local-only-vanished",
      baseVersion: 0,
    });
  });

  it("remote-only-alive: サーバにしか無い生存マップは pull する", () => {
    const remote = toSummary(makeMap({ version: 3 }));
    expect(decideSyncAction(undefined, remote)).toEqual({
      type: "pull",
      reason: "remote-only-alive",
    });
  });

  it("remote-only-deleted: サーバにしか無い削除済みマップは取りに行かない", () => {
    const remote = toSummary(makeMap({ deletedAt: DELETED_AT }));
    expect(decideSyncAction(undefined, remote)).toEqual({
      type: "noop",
      reason: "remote-only-deleted",
    });
  });
});

describe("ADR-005 §3.2 両側にあり、どちらも生存", () => {
  it("in-sync: 版数が一致していれば何もしない", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: false, map: { version: 4 } });
    const remote = toSummary(makeMap({ version: 4 }));
    expect(decideSyncAction(local, remote)).toEqual({ type: "noop", reason: "in-sync" });
  });

  it("local-newer: ローカルだけが進んでいれば push する", () => {
    const local = makeRecord({ syncedVersion: 4, map: { version: 6 } });
    const remote = toSummary(makeMap({ version: 4 }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "push",
      reason: "local-newer",
      baseVersion: 4,
    });
  });

  it("local-newer: version が同値でも dirty なら push する（版数を信用しない）", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: true, map: { version: 4 } });
    const remote = toSummary(makeMap({ version: 4 }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "push",
      reason: "local-newer",
      baseVersion: 4,
    });
  });

  it("remote-newer: サーバだけが進んでいれば pull する", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: false, map: { version: 4 } });
    const remote = toSummary(makeMap({ version: 7 }));
    expect(decideSyncAction(local, remote)).toEqual({ type: "pull", reason: "remote-newer" });
  });

  it("both-modified: 両方変更されていたらローカル版を複製して両方残す", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: true, map: { version: 5 } });
    const remote = toSummary(makeMap({ version: 6 }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "forkLocalCopy",
      reason: "both-modified",
      baseVersion: 4,
    });
  });

  it("サーバ版数がローカルの syncedVersion より古い異常時は何もしない（触らない）", () => {
    const local = makeRecord({ syncedVersion: 9, dirty: false, map: { version: 9 } });
    const remote = toSummary(makeMap({ version: 3 }));
    expect(decideSyncAction(local, remote)).toEqual({ type: "noop", reason: "in-sync" });
  });
});

describe("ADR-005 §3.3 削除がからむ", () => {
  it("local-deleted: ローカルの削除をサーバへ伝える", () => {
    const local = makeRecord({
      syncedVersion: 4,
      dirty: true,
      map: { version: 5, deletedAt: DELETED_AT },
    });
    const remote = toSummary(makeMap({ version: 4 }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "pushDelete",
      reason: "local-deleted",
      baseVersion: 4,
    });
  });

  it("local-deleted-remote-modified: 削除より他デバイスの編集を優先して復元する", () => {
    const local = makeRecord({
      syncedVersion: 4,
      dirty: true,
      map: { version: 5, deletedAt: DELETED_AT },
    });
    const remote = toSummary(makeMap({ version: 8 }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "pullRestore",
      reason: "local-deleted-remote-modified",
    });
  });

  it("remote-deleted: 未送信の変更が無ければサーバの削除を受け入れる", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: false, map: { version: 4 } });
    const remote = toSummary(makeMap({ version: 5, deletedAt: DELETED_AT }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "applyRemoteDelete",
      reason: "remote-deleted",
    });
  });

  it("remote-deleted-local-modified: 未送信の編集があれば複製してから削除を適用する", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: true, map: { version: 6 } });
    const remote = toSummary(makeMap({ version: 5, deletedAt: DELETED_AT }));
    expect(decideSyncAction(local, remote)).toEqual({
      type: "forkLocalCopy",
      reason: "remote-deleted-local-modified",
      baseVersion: 4,
    });
  });

  it("both-deleted: 両方削除済みなら合意済みとして何もしない", () => {
    const local = makeRecord({ syncedVersion: 4, map: { version: 5, deletedAt: DELETED_AT } });
    const remote = toSummary(makeMap({ version: 5, deletedAt: DELETED_AT }));
    expect(decideSyncAction(local, remote)).toEqual({ type: "noop", reason: "both-deleted" });
  });
});

describe("ADR-005 §3.4 初回ログイン時のゲストマップ", () => {
  it("guest-first-login: ゲストマップは baseVersion 0 で push する", () => {
    const local = makeRecord({ userId: null, syncedVersion: 0, dirty: true, map: { version: 1 } });
    expect(decideGuestMigrationAction(local)).toEqual({
      type: "push",
      reason: "guest-first-login",
      baseVersion: 0,
    });
  });

  it("削除済みのゲストマップは送らない", () => {
    const local = makeRecord({
      userId: null,
      syncedVersion: 0,
      map: { version: 1, deletedAt: DELETED_AT },
    });
    expect(decideGuestMigrationAction(local)).toEqual({
      type: "noop",
      reason: "local-only-deleted",
    });
  });
});

describe("純関数であること", () => {
  it("入力を書き換えない", () => {
    const local = makeRecord({ syncedVersion: 4, dirty: true, map: { version: 5 } });
    const remote = toSummary(makeMap({ version: 6 }));
    const localBefore = JSON.stringify(local);
    const remoteBefore = JSON.stringify(remote);

    decideSyncAction(local, remote);

    expect(JSON.stringify(local)).toBe(localBefore);
    expect(JSON.stringify(remote)).toBe(remoteBefore);
  });

  it("同じ入力なら常に同じ結果を返す", () => {
    const local = makeRecord({ syncedVersion: 2, map: { version: 3 } });
    const remote = toSummary(makeMap({ version: 2 }));
    expect(decideSyncAction(local, remote)).toEqual(decideSyncAction(local, remote));
  });
});
