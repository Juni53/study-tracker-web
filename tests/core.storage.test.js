import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { openStorage, requestPersistence, StorageFrozenError } from "../ui/js/core/storage.js";

test("最初は空。get は既定値を返すが、保存はしない", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  assert.deepEqual(s.get("records.json", () => []), []);
  assert.equal(s.has("records.json"), false);
  assert.deepEqual(s.names(), []);
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.equal(s2.has("records.json"), false);          // 既定値は保存されていない
});

test("save したものは、開き直しても残る(本体を書き換えてから save する Python 版の使い方)", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  const records = s.get("records.json", () => []);
  records.push({ id: 1, minutes: 30 });
  s.save("records.json");
  await s.flush();
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.get("records.json", () => []), [{ id: 1, minutes: 30 }]);
  assert.equal(s2.has("records.json"), true);
});

test("save した時点の中身が保存される(あとで本体を書き換えても影響しない)", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  const arr = [1];
  s.save("a.json", arr);
  arr.push(2);                                           // flush 前に書き換え
  await s.flush();
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.get("a.json", () => null), [1]);
});

test("同じファイルへの書き込みは、1つにまとまる(最新が残る)", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  for (let i = 0; i < 50; i++) s.save("n.json", { i });
  assert.equal(s.status().pending, 1);
  await s.flush();
  assert.equal(s.status().pending, 0);
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.get("n.json", () => null), { i: 49 });
});

test("書き込みに失敗してもメモリのデータは残り、次の flush で再試行する", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  const errors = [];
  s.onError((e) => errors.push(e));
  const orig = s._db.transaction.bind(s._db);
  let fail = true;
  s._db.transaction = (...a) => { if (fail) throw new Error("quota"); return orig(...a); };
  s.save("x.json", { v: 1 });
  await assert.rejects(s.flush(), /quota/);
  assert.equal(errors.length >= 1, true);
  assert.equal(s.status().pending, 1);                   // 待ち行列は残っている
  assert.deepEqual(s.get("x.json"), { v: 1 });           // メモリの本体も残っている
  fail = false;
  await s.flush();
  assert.equal(s.status().pending, 0);
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.get("x.json", () => null), { v: 1 });
});

test("IndexedDB が無い環境では、メモリだけで動く(volatile)", async () => {
  const s = await openStorage({ indexedDB: null });
  assert.equal(s.volatile, true);
  s.save("a.json", [1, 2]);
  await s.flush();
  assert.deepEqual(s.get("a.json"), [1, 2]);
  assert.equal(s.status().pending, 0);
});

test("clearAll で、保存されたデータが全部消える", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  s.save("a.json", [1]); s.setMeta("k", 1);
  await s.flush();
  await s.clearAll();
  assert.deepEqual(s.names(), []);
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.names(), []);
  assert.equal(s2.getMeta("k"), null);
});

test("freeze 後は保存できない(別のタブに引き継がれたタブ)", async () => {
  const s = await openStorage({ indexedDB: new IDBFactory() });
  s.save("a.json", [1]);
  s.freeze();
  assert.throws(() => s.save("a.json", [2]), StorageFrozenError);
  assert.throws(() => s.setMeta("k", 1), StorageFrozenError);
  assert.equal(s.status().frozen, true);
});

test("exportAll は、保存済みのファイルだけをコピーで返す", async () => {
  const s = await openStorage({ indexedDB: new IDBFactory() });
  s.get("unused.json", () => []);
  const a = { v: 1 };
  s.save("a.json", a);
  const out = s.exportAll();
  assert.deepEqual(Object.keys(out), ["a.json"]);
  out["a.json"].v = 99;
  assert.equal(a.v, 1);
});

test("メタ情報も保存される", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  s.setMeta("schemaVersion", 1);
  await s.flush(); s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.equal(s2.getMeta("schemaVersion"), 1);
  assert.equal(s2.getMeta("none", "既定"), "既定");
});

test("永続化の要求: 非対応 / 許可 / 拒否 / 例外", async () => {
  assert.deepEqual(await requestPersistence({}), { supported: false, persisted: false });
  assert.deepEqual(await requestPersistence({ storage: { persisted: async () => true, persist: async () => assert.fail() } }), { supported: true, persisted: true });
  assert.deepEqual(await requestPersistence({ storage: { persisted: async () => false, persist: async () => true } }), { supported: true, persisted: true });
  assert.deepEqual(await requestPersistence({ storage: { persisted: async () => false, persist: async () => false } }), { supported: true, persisted: false });
  const r = await requestPersistence({ storage: { persist: async () => { throw new Error("x"); } } });
  assert.equal(r.persisted, false);
});

test("replaceFiles: ファイルをまるごと入れ替える(メタ情報はそのまま・無くなったファイルは消える・開き直しても同じ)", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  s.save("a.json", [1]); s.save("b.json", [2]); s.setMeta("keep", "me");
  await s.replaceFiles({ "a.json": [10], "c.json": { x: 1 } });
  assert.deepEqual(s.names().sort(), ["a.json", "c.json"]);
  assert.deepEqual(s.get("a.json"), [10]);
  assert.equal(s.has("b.json"), false);
  assert.equal(s.getMeta("keep"), "me");
  s.close();
  const s2 = await openStorage({ indexedDB: idb });
  assert.deepEqual(s2.names().sort(), ["a.json", "c.json"]);
  assert.equal(s2.getMeta("keep"), "me");
});

test("replaceFiles: 入れ替えに失敗したら、元のデータが残る(取引は1回)/ 渡した値とは別のコピーを持つ / 凍結中は拒否", async () => {
  const idb = new IDBFactory();
  const s = await openStorage({ indexedDB: idb });
  s.save("a.json", [1]);
  await s.flush();
  const orig = s._db.transaction.bind(s._db);
  s._db.transaction = () => { throw new Error("boom"); };
  await assert.rejects(s.replaceFiles({ "a.json": [99] }), /boom/);
  assert.deepEqual(s.get("a.json"), [1]);                                  // メモリも変わっていない
  s._db.transaction = orig;
  const given = { "a.json": [5] };
  await s.replaceFiles(given);
  given["a.json"].push(6);
  assert.deepEqual(s.get("a.json"), [5]);
  s.close();
  assert.deepEqual((await openStorage({ indexedDB: idb })).get("a.json"), [5]);
  s.freeze();
  await assert.rejects(s.replaceFiles({}), StorageFrozenError);
});

test("replaceFiles: IndexedDB が無い環境(volatile)でもメモリ上で入れ替わる", async () => {
  const s = await openStorage({ indexedDB: null });
  s.save("a.json", [1]);
  await s.replaceFiles({ "z.json": [0] });
  assert.deepEqual(s.names(), ["z.json"]);
});
