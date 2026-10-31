// データ管理・通知・画面消灯防止の API(core/localApi.js)を、偽の platform で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";

const enc = (s) => new TextEncoder().encode(s);

async function setup({ persistence = null } = {}) {
  const idb = new IDBFactory();
  const store = await openStorage({ indexedDB: idb });
  const calls = { download: [], notify: [], wake: [], permission: [], reloads: 0 };
  const platform = {
    picked: null, pickError: null, downloadOk: true, estimate: { usage: 2048, quota: 1e9 },
    download(filename, text, mime) { calls.download.push({ filename, text, mime }); return this.downloadOk ? { ok: true, filename } : { ok: false, error: "x" }; },
    async pickFile() { if (this.pickError) throw this.pickError; return this.picked; },
    notificationPermission: () => "granted",
    async requestNotificationPermission() { calls.permission.push(1); return "granted"; },
    async notify(t, m) { calls.notify.push([t, m]); return { ok: true }; },
    async setWakeLock(on) { calls.wake.push(on); return { ok: true, active: on }; },
    reload() { calls.reloads++; },
    async storageEstimate() { return this.estimate; },
  };
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  const api = new Api(store, { platform, persistence });
  return { api, store, platform, calls, idb, restore };
}

test("export_csv: BOM つきの CSV を、日付入りのファイル名でダウンロードする", async () => {
  const { api, calls, restore } = await setup();
  try {
    api.add_record("2026-10-27", "1h", "内容", [1], [], "manual", 4, null);
    const r = await api.export_csv();
    assert.deepEqual(r, { ok: true, path: "study_export_2026-10-27.csv" });
    const d = calls.download[0];
    assert.equal(d.filename, "study_export_2026-10-27.csv");
    assert.equal(d.mime, "text/csv;charset=utf-8");
    assert.ok(d.text.startsWith("\ufeffdate,minutes,content,tags,exams,source,quality,points_earned\r\n"));
    assert.ok(d.text.includes("2026-10-27,60,内容,数学,,manual,4,"));
  } finally { restore(); }
});

test("export_csv: ダウンロードできない環境では ok:false", async () => {
  const { api, platform, restore } = await setup();
  try { platform.downloadOk = false; assert.equal((await api.export_csv()).ok, false); } finally { restore(); }
});

test("import_csv: ファイルを選ばなければ cancelled / 選べば取り込む / 選択でエラーなら ok:false", async () => {
  const { api, platform, store, restore } = await setup();
  try {
    platform.picked = null;
    assert.deepEqual(await api.import_csv(), { ok: true, cancelled: true });
    platform.picked = { name: "a.csv", bytes: enc("date,minutes,content\n2026-10-20,30,取込\n") };
    const r = await api.import_csv();
    assert.equal(r.ok, true); assert.equal(r.added, 1);
    assert.equal(api.get_records().length, 1);
    const backup = store.getMeta("records_before_import");                    // 取り込み前の控え
    assert.deepEqual(backup.records, []);
    platform.pickError = new Error("ファイルが大きすぎます(20MBまで)");
    assert.deepEqual(await api.import_csv(), { ok: false, error: "ファイルが大きすぎます(20MBまで)" });
  } finally { restore(); }
});

test("import_csv: 行数の上限(50000行)", async () => {
  const { api, restore } = await setup();
  try {
    const row = "2026-10-20,30,x\n";
    const over = "date,minutes,content\n" + row.repeat(50001);
    assert.match((api.dm.importCsv(enc(over))).error, /行数が多すぎます/);
    assert.equal(api.get_records().length, 0);
  } finally { restore(); }
});

test("import_csv: 無限大の分・改行だけの区切り(Python 版は例外で止まる入力)は、エラー/不正な行として扱う", async () => {
  const { api, restore } = await setup();
  try {
    const r = api.dm.importCsv(enc("date,minutes,content\n2026-10-20,inf,無限大\n2026-10-20,30,正常\n"));
    assert.equal(r.ok, true); assert.equal(r.added, 1); assert.equal(r.invalid_count, 1);
    const cr = api.dm.importCsv(enc("date,minutes\r2026-10-20,30\r"));                   // CR だけの改行
    assert.equal(cr.ok, false); assert.match(cr.error, /読み込めませんでした/);
    assert.equal(api.get_records().length, 1);
  } finally { restore(); }
});

test("reset_all_data: 保存データを全部消して再読み込みする(開き直しても空)", async () => {
  const { api, store, calls, idb, restore } = await setup();
  try {
    api.add_record("2026-10-27", "1h", "x", [], [], "manual");
    api.update_setting("theme", "dark");
    await store.flush();
    assert.deepEqual(await api.reset_all_data(), { ok: true });
    assert.equal(calls.reloads, 1);
    assert.deepEqual(store.names(), []);
    store.close();
    const again = await openStorage({ indexedDB: idb });
    assert.deepEqual(again.names(), []);
    assert.equal(again.getMeta("records_before_import"), null);
  } finally { restore(); }
});

test("通知・画面消灯防止・通知の許可は、platform へ渡される", async () => {
  const { api, calls, restore } = await setup();
  try {
    assert.deepEqual(await api.notify_desktop("題", "本文"), { ok: true });
    assert.deepEqual(calls.notify, [["題", "本文"]]);
    assert.deepEqual(await api.set_idle_inhibit(true), { ok: true, active: true });
    assert.deepEqual(await api.set_idle_inhibit(false), { ok: true, active: false });
    assert.deepEqual(calls.wake, [true, false]);
    assert.deepEqual(await api.request_notification_permission(), { permission: "granted" });
  } finally { restore(); }
});

test("get_storage_info / open_data_folder", async () => {
  const a = await setup({ persistence: { supported: true, persisted: true } });
  try {
    assert.deepEqual(await a.api.get_storage_info(), { volatile: false, persisted: true, usage: 2048, quota: 1e9 });
    assert.deepEqual(a.api.open_data_folder(), { ok: false, unsupported: true });
  } finally { a.restore(); }
  const b = await setup({ persistence: { supported: false, persisted: false } });
  try { assert.equal((await b.api.get_storage_info()).persisted, null); } finally { b.restore(); }
  const c = await setup();
  try { c.platform.estimate = null; const i = await c.api.get_storage_info(); assert.equal(i.usage, null); assert.equal(i.persisted, null); } finally { c.restore(); }
});
