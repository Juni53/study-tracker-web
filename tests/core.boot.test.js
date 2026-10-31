import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { bootApp } from "../ui/js/core/boot.js";
import { Api, API_METHODS, WEB_ONLY_METHODS } from "../ui/js/core/localApi.js";
import { StorageFrozenError } from "../ui/js/core/storage.js";
import { createFakeLocks } from "./_fakeLocks.js";
import { setupDom } from "./_dom.js";

const nav = { storage: { persisted: async () => false, persist: async () => true } };
const tick = () => new Promise((r) => setTimeout(r, 0));

test("通常の起動: 設定が既定値で読め、永続化も要求される", async () => {
  const { api, persistence } = await bootApp({ ui: {}, locks: createFakeLocks(), indexedDB: new IDBFactory(), navigator: nav });
  assert.equal(api.get_settings().theme, "system");
  assert.equal(api.get_settings().pomodoro.work, 25);
  assert.equal(api.get_points_balance(), 0);
  assert.deepEqual(persistence, { supported: true, persisted: true });
});

test("設定の変更は、起動し直しても残る", async () => {
  const idb = new IDBFactory(), locks = createFakeLocks();
  const a = await bootApp({ ui: {}, locks, indexedDB: idb, navigator: nav });
  a.api.update_setting("theme", "dark");
  await a.store.flush();
  a.guard.release(); a.store.close();
  await tick();
  const b = await bootApp({ ui: {}, locks, indexedDB: idb, navigator: nav });
  assert.equal(b.api.get_settings().theme, "dark");
});

test("別のタブが使用中: 「このタブで使う」で引き継ぎ、元のタブは保存できなくなる", async () => {
  const idb = new IDBFactory(), locks = createFakeLocks();
  const log = [];
  const first = await bootApp({ ui: { showLost: () => log.push("lost") }, locks, indexedDB: idb, navigator: nav });
  first.api.update_setting("theme", "light");
  await first.store.flush();

  const second = await bootApp({
    ui: { showBlocked: async (takeOver) => { log.push("blocked"); await takeOver(); } },
    locks, indexedDB: idb, navigator: nav,
  });
  await tick();
  assert.deepEqual(log, ["blocked", "lost"]);
  assert.equal(second.api.get_settings().theme, "light");                 // 奪った側は、最後に書かれたデータを読む
  assert.throws(() => first.api.update_setting("theme", "dark"), StorageFrozenError);   // 元のタブは書けない
  second.api.update_setting("theme", "dark");
  await second.store.flush();
});

test("別のタブが使用中で、画面が無ければ起動を止める", async () => {
  const locks = createFakeLocks();
  await bootApp({ ui: {}, locks, indexedDB: new IDBFactory(), navigator: nav });
  await assert.rejects(bootApp({ ui: {}, locks, indexedDB: new IDBFactory(), navigator: nav }), /別のタブ/);
});

test("IndexedDB が使えない環境では、警告を出してメモリで動く", async () => {
  let warned = 0;
  const { api, store } = await bootApp({ ui: { showVolatile: () => warned++ }, locks: null, indexedDB: null, navigator: {} });
  assert.equal(store.volatile, true);
  assert.equal(warned, 1);
  api.update_setting("theme", "dark");
  assert.equal(api.get_settings().theme, "dark");
});

test("API の一覧が、Python 版 Api の公開メソッドと一致する", () => {
  const surface = JSON.parse(readFileSync(new URL("./golden/api_surface.json", import.meta.url), "utf8"));
  assert.deepEqual([...API_METHODS].sort(), surface);
  for (const name of API_METHODS) assert.equal(typeof Api.prototype[name], "function", name);
});

test("Python 版の API は、すべて移植済み(未移植のエラーを投げるものが残っていない)", () => {
  for (const name of API_METHODS) {
    assert.ok(!String(Api.prototype[name]).includes("NotPortedError"), `${name} が未移植`);
  }
  for (const name of WEB_ONLY_METHODS) assert.equal(typeof Api.prototype[name], "function", name);
});

test("api.js の入口: 引数と戻り値は複製され、内部データを書き換えられない", async () => {
  setupDom();
  const { api } = await import("../ui/js/api.js");
  const s = await api.get_settings();
  s.theme = "ぐちゃぐちゃ";
  s.pomodoro.work = 999;
  const s2 = await api.get_settings();
  assert.equal(s2.theme, "system");
  assert.equal(s2.pomodoro.work, 25);
  await assert.rejects(api.no_such_method(), /存在しません/);
  assert.equal(await api.then, undefined);                // await api で Promise と誤認されない
});
