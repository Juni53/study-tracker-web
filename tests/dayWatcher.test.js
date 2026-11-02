// 日付が変わったときの見張り(components/dayWatcher.js): 部品だけを、偽の部品(API・タイマー・状態)でテストする。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { startDayWatcher } from "../ui/js/components/dayWatcher.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);

// 偽の環境を作る。day / busy / idle / failRollover は、テストから動かす
function setup({ day = "2026-11-10" } = {}) {
  const env = {
    day, busy: false, idle: true, failRollover: 0, rolls: 0, refreshes: 0, rolled: [], busyCb: null,
    intervals: [], timeouts: [], winListeners: {}, stops: [],
  };
  const timers = {
    setInterval: (fn, ms) => { env.intervals.push({ fn, ms, alive: true }); return env.intervals.length - 1; },
    clearInterval: (id) => { if (env.intervals[id]) env.intervals[id].alive = false; },
    setTimeout: (fn, ms) => { env.timeouts.push({ fn, ms, alive: true }); return env.timeouts.length - 1; },
    clearTimeout: (id) => { if (env.timeouts[id]) env.timeouts[id].alive = false; },
  };
  const win = {
    addEventListener: (t, fn) => { (env.winListeners[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { env.winListeners[t]?.delete(fn); },
  };
  const api = {
    async run_day_rollover() {
      env.rolls++;
      if (env.failRollover > 0) { env.failRollover--; throw new Error("失敗"); }
      return { ok: true, sabori_applied: [] };
    },
  };
  const w = startDayWatcher({
    api, today: () => env.day, isBusy: () => env.busy,
    subscribeBusy: (fn) => { env.busyCb = fn; return () => { env.busyCb = null; }; },
    isIdle: () => env.idle, refresh: async () => { env.refreshes++; }, onRolled: (r) => env.rolled.push(r),
    doc: document, win, timers, intervalMs: 60_000, retryMs: 3_000,
  });
  env.w = w;
  env.fireRetry = async () => { const t = env.timeouts.filter((x) => x.alive).pop(); assert.ok(t, "再試行の予約が無い"); t.alive = false; t.fn(); await tick(); await tick(); };
  return env;
}
const settle = async () => { await tick(); await tick(); await tick(); };
const notice = () => document.querySelector(".day-notice");
const cleanup = (env) => { env.w.stop(); };

test("日付が同じなら、何もしない(起動時処理のやり直しも、画面の更新もしない)", async () => {
  const e = setup();
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes, e.rolled.length], [0, 0, 0]);
  assert.equal(notice(), null);
  cleanup(e);
});

test("日付が変わったら、起動時処理をやり直して、画面を更新し、onRolled を呼ぶ(1回だけ)", async () => {
  const e = setup();
  e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes, e.rolled.length], [1, 1, 1]);
  assert.deepEqual(e.w.state, { lastDay: "2026-11-11", dataPending: false, viewPending: false, noticeShown: false });
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes], [1, 1], "同じ日なのに、またやり直した");
  e.day = "2026-11-12";                                   // さらに翌日 → もう一度
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes], [2, 2]);
  cleanup(e);
});

test("ストップウォッチが動いている間は、起動時処理も画面の更新も保留して、お知らせを出す。計測が終わったら、自動で進めて、お知らせを消す", async () => {
  const e = setup();
  e.busy = true; e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes], [0, 0], "計測中なのに、更新した");
  assert.ok(notice(), "お知らせが出ていない");
  assert.match(notice().textContent, /日付が変わりました/);
  assert.match(notice().textContent, /ストップウォッチの計測中のため、更新を保留しています/);
  assert.match(notice().textContent, /止めて保存\(またはリセット\)すると、自動で更新します/);
  assert.equal(document.querySelectorAll(".day-notice").length, 1);
  await e.w.check(); await e.w.check(); await settle();   // 何度確認しても、お知らせは1つ
  assert.equal(document.querySelectorAll(".day-notice").length, 1);
  assert.equal(e.w.state.dataPending, true);

  e.busy = false; e.busyCb(); await settle();             // 計測が終わった(subscribe の通知)
  assert.deepEqual([e.rolls, e.refreshes, e.rolled.length], [1, 1, 1]);
  assert.equal(notice(), null, "お知らせが消えていない");
  cleanup(e);
});

test("計測中に何度、計測の状態が変わっても(毎秒の通知)、保留中以外は、何もしない", async () => {
  const e = setup();
  for (let i = 0; i < 5; i++) { e.busyCb(); await settle(); }
  assert.deepEqual([e.rolls, e.refreshes], [0, 0]);
  assert.equal(notice(), null);
  cleanup(e);
});

test("お知らせの「閉じる」: 隠れるが、保留は続く。同じ保留のあいだは、また出ない。次の日付変更では、また出る", async () => {
  const e = setup();
  e.busy = true; e.day = "2026-11-11";
  await e.w.check(); await settle();
  notice().querySelector('[data-day="close"]').click();
  assert.equal(notice(), null);
  assert.equal(e.w.state.dataPending, true, "閉じたら、保留が消えた");
  e.busyCb(); await e.w.check(); await settle();
  assert.equal(notice(), null, "閉じたのに、また出た");
  e.busy = false; e.busyCb(); await settle();
  assert.equal(e.rolls, 1);
  e.busy = true; e.day = "2026-11-12";                    // 次の日付変更
  await e.w.check(); await settle();
  assert.ok(notice(), "次の日付変更で、お知らせが出ない");
  cleanup(e);
});

test("ポップアップが開いている・入力中(idle でない)なら、起動時処理は進めるが、画面の更新は待つ。使い終わったら更新する", async () => {
  const e = setup();
  e.idle = false; e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.deepEqual([e.rolls, e.refreshes], [1, 0]);
  assert.equal(e.w.state.viewPending, true);
  assert.equal(notice(), null, "計測中でないのに、お知らせが出た");
  await e.fireRetry();                                    // まだ使用中 → また待つ
  assert.equal(e.refreshes, 0);
  e.idle = true;
  await e.fireRetry();
  assert.deepEqual([e.rolls, e.refreshes], [1, 1]);
  assert.equal(e.w.state.viewPending, false);
  cleanup(e);
});

test("待っているあいだに、タブを切り替えて画面が新しく描かれたら(viewRendered)、もう描き直さない", async () => {
  const e = setup();
  e.idle = false; e.day = "2026-11-11";
  await e.w.check(); await settle();
  e.w.viewRendered();
  assert.equal(e.w.state.viewPending, false);
  e.idle = true;
  await e.w.check(); await settle();
  assert.equal(e.refreshes, 0, "新しく描かれたのに、もう一度描き直した");
  // 起動時処理が済む前(計測中)の viewRendered では、保留は消えない
  const f = setup();
  f.busy = true; f.day = "2026-11-11";
  await f.w.check(); await settle();
  f.w.viewRendered();
  assert.equal(f.w.state.dataPending, true);
  f.busy = false; f.busyCb(); await settle();
  assert.equal(f.rolls, 1);
  cleanup(e); cleanup(f);
});

test("起動時処理が失敗したら、再試行を予約して、直ったら進める(画面は、成功してから更新する)", async () => {
  const e = setup();
  e.failRollover = 2; e.day = "2026-11-11";
  const spy = console.error; console.error = () => {};
  try {
    await e.w.check(); await settle();
    assert.deepEqual([e.rolls, e.refreshes], [1, 0]);
    assert.equal(e.w.state.dataPending, true);
    await e.fireRetry();
    assert.deepEqual([e.rolls, e.refreshes], [2, 0]);
    await e.fireRetry();
    assert.deepEqual([e.rolls, e.refreshes, e.rolled.length], [3, 1, 1]);
  } finally { console.error = spy; }
  cleanup(e);
});

test("同時に呼ばれても、起動時処理は1回だけ(処理中は、重ならない)", async () => {
  const e = setup();
  e.day = "2026-11-11";
  await Promise.all([e.w.check(), e.w.check(), e.w.check()]); await settle();
  assert.equal(e.rolls, 1);
  cleanup(e);
});

test("見張りのきっかけ: 60秒ごと / 画面が再び見えたとき / pageshow。見えなくなったときは、動かない", async () => {
  const e = setup();
  assert.deepEqual(e.intervals.map((i) => i.ms), [60_000]);
  e.day = "2026-11-11";
  const vis = (state) => { Object.defineProperty(document, "visibilityState", { value: state, configurable: true }); document.dispatchEvent(new window.Event("visibilitychange")); };
  vis("hidden"); await settle();
  assert.equal(e.rolls, 0, "見えなくなっただけで動いた");
  vis("visible"); await settle();
  assert.equal(e.rolls, 1);
  e.day = "2026-11-12";
  e.intervals[0].fn(); await settle();                    // 60秒ごと
  assert.equal(e.rolls, 2);
  e.day = "2026-11-13";
  [...e.winListeners.pageshow][0](); await settle();       // ページが戻ってきたとき
  assert.equal(e.rolls, 3);
  cleanup(e);
});

test("stop(): タイマー・イベントの登録・お知らせを、すべて片付ける。そのあとは、何もしない", async () => {
  const e = setup();
  e.busy = true; e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.ok(notice());
  e.w.stop();
  assert.equal(notice(), null);
  assert.equal(e.intervals[0].alive, false);
  assert.equal(e.winListeners.pageshow.size, 0);
  assert.equal(e.busyCb, null);
  e.busy = false;
  await e.w.check(); await settle();
  assert.equal(e.rolls, 0, "stop のあとに動いた");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange")); await settle();
  assert.equal(e.rolls, 0);
});

test("README / 部品の説明: 保留する理由(日をまたぐ計測は、開始日で保存される)が、コードに書いてある", () => {
  const src = readFileSync(new URL("../ui/js/components/dayWatcher.js", import.meta.url), "utf8");
  assert.match(src, /開始日/);
  assert.match(src, /さぼり券を無駄に使ってしまう/);
});
