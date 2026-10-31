// ブラウザ固有の機能(platform.js)を、偽のブラウザで確かめる。実機での動作確認は別に必要。
import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserPlatform, unsupportedPlatform } from "../ui/js/core/platform.js";

function fakeEnv({ notification, wakeLock, serviceWorker, visibility = "visible", showSaveFilePicker } = {}) {
  const log = { anchors: [], blobs: [], revoked: [], inputs: [], timeouts: [], reloads: 0, focusCalls: 0 };
  const docListeners = {}, winListeners = {};
  const makeEl = (tag) => {
    const el = { tag, style: {}, listeners: {}, removed: false, clicked: false,
      addEventListener(t, f) { (el.listeners[t] ||= []).push(f); },
      click() { el.clicked = true; }, remove() { el.removed = true; } };
    if (tag === "a") log.anchors.push(el);
    if (tag === "input") log.inputs.push(el);
    return el;
  };
  const doc = {
    visibilityState: visibility,
    body: { appendChild() {} },
    createElement: makeEl,
    addEventListener(t, f) { (docListeners[t] ||= []).push(f); },
  };
  const env = {
    document: doc,
    navigator: { wakeLock, serviceWorker, storage: { estimate: async () => ({ usage: 1234, quota: 99999 }) } },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts.type; log.blobs.push(this); } },
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL: (u) => log.revoked.push(u) },
    setTimeout: (f, ms) => { log.timeouts.push([f, ms]); return 1; },
    addEventListener(t, f) { (winListeners[t] ||= []).push(f); },
    focus() { log.focusCalls++; },
    location: { reload() { log.reloads++; } },
  };
  if (notification) env.Notification = notification;
  if (showSaveFilePicker) env.showSaveFilePicker = showSaveFilePicker;
  return { env, log, fire: (t) => (docListeners[t] || []).forEach((f) => f()), winListeners, doc };
}

test("download: Blob を作ってリンクを押し、あとで URL を解放する", () => {
  const { env, log } = fakeEnv();
  const p = createBrowserPlatform(env);
  const r = p.download("a.csv", "\ufeffdate\r\n", "text/csv;charset=utf-8");
  assert.deepEqual(r, { ok: true, filename: "a.csv" });
  assert.equal(log.anchors.length, 1);
  assert.equal(log.anchors[0].download, "a.csv");
  assert.equal(log.anchors[0].href, "blob:fake");
  assert.ok(log.anchors[0].clicked && log.anchors[0].removed);
  assert.equal(log.blobs[0].parts[0], "\ufeffdate\r\n");
  assert.equal(log.blobs[0].type, "text/csv;charset=utf-8");
  log.timeouts[0][0]();
  assert.deepEqual(log.revoked, ["blob:fake"]);
});

test("pickFile: 選んだファイルのバイト列を返す / 閉じたら null / 大きすぎれば例外", async () => {
  const { env, log } = fakeEnv();
  const p = createBrowserPlatform(env);

  let pr = p.pickFile({ accept: ".csv" });
  let input = log.inputs.at(-1);
  assert.equal(input.accept, ".csv");
  assert.ok(input.clicked);
  input.files = [{ name: "x.csv", size: 3, arrayBuffer: async () => new Uint8Array([97, 98, 99]).buffer }];
  input.listeners.change.forEach((f) => f());
  const picked = await pr;
  assert.equal(picked.name, "x.csv");
  assert.deepEqual([...picked.bytes], [97, 98, 99]);
  assert.ok(input.removed);

  pr = p.pickFile();
  input = log.inputs.at(-1);
  input.listeners.cancel.forEach((f) => f());
  assert.equal(await pr, null);

  pr = p.pickFile();
  input = log.inputs.at(-1);
  input.files = [{ name: "big.csv", size: 21 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) }];
  input.listeners.change.forEach((f) => f());
  await assert.rejects(pr, /大きすぎます/);
});

test("pickFile: cancel イベントの無いブラウザでも、閉じたあとに画面へ戻ったら null", async () => {
  const { env, log, winListeners } = fakeEnv();
  const p = createBrowserPlatform(env);
  const pr = p.pickFile();
  winListeners.focus.forEach((f) => f());                 // ダイアログを閉じて、画面に戻った
  log.timeouts.at(-1)[0]();                                // 少し待ったあと、まだ選択が無い
  assert.equal(await pr, null);
});

test("通知: 許可の状態に応じて、許可を求める・通知を出す", async () => {
  const shown = [];
  class N {
    static permission = "default";
    static async requestPermission() { N.permission = "granted"; return "granted"; }
    constructor(title, opts) { shown.push([title, opts]); }
    close() {}
  }
  const { env } = fakeEnv({ notification: N });
  const p = createBrowserPlatform(env);
  assert.equal(p.notificationPermission(), "default");
  assert.deepEqual(await p.notify("t", "m"), { ok: false, reason: "default" });    // 許可前は出さない
  assert.equal(await p.requestNotificationPermission(), "granted");
  assert.equal(await p.requestNotificationPermission(), "granted");                 // 決まっていれば、再度は聞かない
  assert.deepEqual(await p.notify("休憩の時間です", "作業が終わりました"), { ok: true });
  assert.deepEqual(shown, [["休憩の時間です", { body: "作業が終わりました", tag: "study-tracker-phase" }]]);

  N.permission = "denied";
  assert.deepEqual(await p.notify("t", "m"), { ok: false, reason: "denied" });
});

test("通知: コンストラクタが使えない環境は Service Worker 経由 / 非対応環境は ok:false", async () => {
  const shown = [];
  class N { static permission = "granted"; constructor() { throw new TypeError("Illegal constructor"); } }
  const sw = { getRegistration: async () => ({ showNotification: async (t, o) => shown.push([t, o.body]) }) };
  const { env } = fakeEnv({ notification: N, serviceWorker: sw });
  assert.deepEqual(await createBrowserPlatform(env).notify("a", "b"), { ok: true });
  assert.deepEqual(shown, [["a", "b"]]);

  const noSw = fakeEnv({ notification: N, serviceWorker: { getRegistration: async () => undefined } });
  assert.equal((await createBrowserPlatform(noSw.env).notify("a", "b")).ok, false);

  const none = fakeEnv();
  const p = createBrowserPlatform(none.env);
  assert.equal(p.notificationPermission(), "unsupported");
  assert.deepEqual(await p.notify("a", "b"), { ok: false, reason: "unsupported" });
  assert.equal(await p.requestNotificationPermission(), "unsupported");
});

test("画面の消灯防止: 取得・解除・非表示で自動解除されたら、見えたときに取り直す", async () => {
  const sentinels = [];
  const wakeLock = { request: async () => { const s = { released: false, listeners: [], addEventListener(t, f) { s.listeners.push(f); }, async release() { s.released = true; } }; sentinels.push(s); return s; } };
  const { env, fire, doc } = fakeEnv({ wakeLock });
  const p = createBrowserPlatform(env);

  assert.deepEqual(await p.setWakeLock(true), { ok: true, active: true });
  assert.equal(sentinels.length, 1);

  // 画面が隠れて、ブラウザが自動で解除 → 見えたとき、まだ必要なら取り直す
  doc.visibilityState = "hidden";
  sentinels[0].listeners.forEach((f) => f());
  fire("visibilitychange");
  assert.equal(sentinels.length, 1);
  doc.visibilityState = "visible";
  fire("visibilitychange");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sentinels.length, 2);

  assert.deepEqual(await p.setWakeLock(false), { ok: true, active: false });
  assert.ok(sentinels[1].released);
  fire("visibilitychange");                                 // 不要になったあとは、取り直さない
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sentinels.length, 2);
});

test("画面の消灯防止: 非対応環境・取得に失敗する環境でも、例外にならない", async () => {
  assert.deepEqual(await createBrowserPlatform(fakeEnv().env).setWakeLock(true), { ok: false, active: false, error: "unsupported" });
  const denied = fakeEnv({ wakeLock: { request: async () => { throw new Error("NotAllowedError"); } } });
  assert.deepEqual(await createBrowserPlatform(denied.env).setWakeLock(true), { ok: false, active: false });
  assert.deepEqual(await createBrowserPlatform(denied.env).setWakeLock(false), { ok: true, active: false });
});

test("再読み込み・保存容量・何もしない実装", async () => {
  const { env, log } = fakeEnv();
  const p = createBrowserPlatform(env);
  p.reload();
  assert.equal(log.reloads, 1);
  assert.deepEqual(await p.storageEstimate(), { usage: 1234, quota: 99999 });
  assert.equal(unsupportedPlatform.download().ok, false);
  assert.equal(await unsupportedPlatform.pickFile(), null);
  assert.equal(await unsupportedPlatform.storageEstimate(), null);
});

test("saveFile: 保存先を選べるブラウザでは、選んだ場所に書く(次回は前回のフォルダから始まる)", async () => {
  const written = [];
  let opts;
  const picker = async (o) => { opts = o; return { name: "選んだ名前.json", createWritable: async () => ({ write: async (t) => written.push(t), close: async () => written.push("<close>") }) }; };
  const { env, log } = fakeEnv({ showSaveFilePicker: picker });
  const p = createBrowserPlatform(env);
  assert.equal(p.savePickerSupported(), true);
  const r = await p.saveFile("b.json", "{\"a\":1}");
  assert.deepEqual(r, { ok: true, filename: "選んだ名前.json", method: "picker" });
  assert.deepEqual(written, ["{\"a\":1}", "<close>"]);
  assert.equal(opts.suggestedName, "b.json");
  assert.equal(opts.id, "study-tracker-backup");
  assert.deepEqual(opts.types[0].accept, { "application/json": [".json"] });
  assert.equal(log.anchors.length, 0);                                      // ダウンロードは使わない
});

test("saveFile: 保存先を選ばずに閉じたら cancelled / 操作の直後でないなどで使えなければダウンロード / その他の失敗は ok:false", async () => {
  const abort = fakeEnv({ showSaveFilePicker: async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); } });
  assert.deepEqual(await createBrowserPlatform(abort.env).saveFile("b.json", "t"), { ok: true, cancelled: true });
  assert.equal(abort.log.anchors.length, 0);

  for (const name of ["SecurityError", "NotAllowedError", "TypeError"]) {
    const sec = fakeEnv({ showSaveFilePicker: async () => { throw Object.assign(new Error("x"), { name }); } });
    const r = await createBrowserPlatform(sec.env).saveFile("b.json", "t");
    assert.deepEqual(r, { ok: true, filename: "b.json", method: "download" }, name);
    assert.equal(sec.log.anchors.length, 1);
  }

  const bad = fakeEnv({ showSaveFilePicker: async () => { throw Object.assign(new Error("disk full"), { name: "QuotaExceededError" }); } });
  const r = await createBrowserPlatform(bad.env).saveFile("b.json", "t");
  assert.equal(r.ok, false); assert.match(r.error, /disk full/);
  assert.equal(bad.log.anchors.length, 0);
});

test("saveFile: File System Access API が無いブラウザは、ダウンロードにする", async () => {
  const { env, log } = fakeEnv();
  const p = createBrowserPlatform(env);
  assert.equal(p.savePickerSupported(), false);
  assert.deepEqual(await p.saveFile("b.json", "t", "application/json"), { ok: true, filename: "b.json", method: "download" });
  assert.equal(log.blobs[0].type, "application/json");
  assert.equal((await unsupportedPlatform.saveFile()).ok, false);
  assert.equal(unsupportedPlatform.savePickerSupported(), false);
});
