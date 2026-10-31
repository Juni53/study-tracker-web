// Service Worker の登録・更新の受け取り(ui/js/pwa.js)を、偽の navigator.serviceWorker で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { registerServiceWorker, applyUpdate, checkForUpdate } from "../ui/js/pwa.js";

// 最小の EventTarget もどき
function target() {
  const l = {};
  return { addEventListener: (t, f) => (l[t] ||= []).push(f), fire: (t, ev = {}) => (l[t] || []).forEach((f) => f(ev)), count: (t) => (l[t] || []).length };
}
function fakeEnv({ controller = {}, waiting = null } = {}) {
  const sw = Object.assign(target(), { controller, registerArgs: null });
  const reg = Object.assign(target(), { waiting, installing: null, updates: 0, update: async function () { this.updates++; } });
  sw.register = async (url, opts) => { sw.registerArgs = [url, opts]; return reg; };
  const doc = Object.assign(target(), { visibilityState: "visible" });
  return { nav: { serviceWorker: sw }, sw, reg, doc };
}
const worker = () => Object.assign(target(), { state: "installing", posted: [], postMessage(m) { this.posted.push(m); } });

test("開発版(BUILD_ID が dev)・非対応のブラウザ・登録に失敗する環境では、何もしない(例外にもならない)", async () => {
  const e = fakeEnv();
  assert.equal(await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "dev" }), null);
  assert.equal(e.sw.registerArgs, null);
  assert.equal(await registerServiceWorker({ nav: {}, doc: e.doc, buildId: "abc" }), null);
  assert.equal(await registerServiceWorker({ nav: null, doc: e.doc, buildId: "abc" }), null);
  e.sw.register = async () => { throw new Error("SecurityError"); };
  assert.equal(await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "abc" }), null);
});

test("登録: sw.js をこのアプリの範囲(./)で、スクリプトを HTTP キャッシュに頼らず登録する", async () => {
  const e = fakeEnv();
  const reg = await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "abc123" });
  assert.equal(reg, e.reg);
  assert.deepEqual(e.sw.registerArgs, ["sw.js", { scope: "./", updateViaCache: "none" }]);
});

test("初めてのインストール(まだ制御されていない)では、更新のお知らせを出さない", async () => {
  const e = fakeEnv({ controller: null });
  let notified = 0;
  await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "abc", onUpdateReady: () => notified++ });
  const w = worker(); e.reg.installing = w;
  e.reg.fire("updatefound");
  w.state = "installed"; w.fire("statechange");
  assert.equal(notified, 0);
});

test("すでに動いている版があるとき、新しい版が取得できたら(installed)、お知らせを出す。途中の状態では出さない", async () => {
  const e = fakeEnv();
  let notified = [];
  await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "abc", onUpdateReady: (r) => notified.push(r) });
  const w = worker(); e.reg.installing = w;
  e.reg.fire("updatefound");
  w.state = "installing"; w.fire("statechange");
  assert.equal(notified.length, 0);
  w.state = "installed"; w.fire("statechange");
  assert.deepEqual(notified, [e.reg]);
});

test("前から待機している新しい版が見つかったら、起動時にお知らせを出す(制御されているときだけ)", async () => {
  const withWaiting = fakeEnv({ waiting: worker() });
  let n = 0;
  await registerServiceWorker({ nav: withWaiting.nav, doc: withWaiting.doc, buildId: "abc", onUpdateReady: () => n++ });
  assert.equal(n, 1);
  const noController = fakeEnv({ controller: null, waiting: worker() });
  await registerServiceWorker({ nav: noController.nav, doc: noController.doc, buildId: "abc", onUpdateReady: () => n++ });
  assert.equal(n, 1);
});

test("更新する: 待機中の版に SKIP_WAITING を送り、切り替わったら1度だけ再読み込みする", () => {
  const e = fakeEnv();
  const w = worker(); e.reg.waiting = w;
  let reloads = 0;
  assert.equal(applyUpdate(e.reg, { nav: e.nav, loc: { reload: () => reloads++ } }), true);
  assert.deepEqual(w.posted, [{ type: "SKIP_WAITING" }]);
  assert.equal(reloads, 0);                                   // 切り替わるまで、再読み込みしない
  e.sw.fire("controllerchange");
  e.sw.fire("controllerchange");
  assert.equal(reloads, 1);
  e.reg.waiting = null;
  assert.equal(applyUpdate(e.reg, { nav: e.nav, loc: { reload() {} } }), false);   // 待機中の版が無ければ、何もしない
});

test("更新の確認: 新しい版がある / 取得中 / 最新", async () => {
  const e = fakeEnv();
  assert.equal(await checkForUpdate(e.reg), "latest");
  e.reg.installing = worker();
  assert.equal(await checkForUpdate(e.reg), "installing");
  e.reg.installing = null; e.reg.waiting = worker();
  assert.equal(await checkForUpdate(e.reg), "available");
  assert.equal(e.reg.updates, 3);
});

test("画面が見える状態に戻ったとき、前回の確認から1時間以上たっていれば更新を確認する(それまでは確認しない)", async () => {
  const e = fakeEnv();
  let t = 1_000_000;
  await registerServiceWorker({ nav: e.nav, doc: e.doc, buildId: "abc", now: () => t });
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 0);                             // 直後は確認しない
  t += 59 * 60 * 1000;
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 0);
  t += 2 * 60 * 1000;
  e.doc.visibilityState = "hidden"; e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 0);                             // 見えないときは確認しない
  e.doc.visibilityState = "visible"; e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 1);
  e.doc.fire("visibilitychange");
  assert.equal(e.reg.updates, 1);                             // 確認した直後は、また確認しない
});
