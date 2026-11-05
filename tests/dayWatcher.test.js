// 日付が変わったときの見張り(components/dayWatcher.js): 部品だけを、偽の部品(API・タイマー・時計)でテストする。
// 見張りの方法は「次の 0 時に 1 回だけ鳴るタイマー」(2026-11-02 の再設計)。計測中でも保留しない(保留の仕組みは、無い)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { startDayWatcher, msUntilNextMidnight, nextWatchDelay, MAX_WAIT_MS, MARGIN_MS } from "../ui/js/components/dayWatcher.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);

const HOUR = 3_600_000;
const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

// 偽の環境を作る。day / now / idle / failRollover は、テストから動かす。events は、呼ばれた順の記録
function setup({ day = "2026-11-10", now = new Date(2026, 10, 10, 10, 0, 0) } = {}) {
  const env = {
    day, now, idle: true, failRollover: 0, events: [], rolled: [], dayChanged: [],
    timeouts: [], winListeners: {}, unrefs: 0,
  };
  const timers = {
    setTimeout: (fn, ms) => {
      const t = { fn, ms, alive: true, unref() { env.unrefs++; } };
      env.timeouts.push(t);
      return t;
    },
    clearTimeout: (t) => { if (t) t.alive = false; },
  };
  const win = {
    addEventListener: (t, fn) => { (env.winListeners[t] ||= new Set()).add(fn); },
    removeEventListener: (t, fn) => { env.winListeners[t]?.delete(fn); },
  };
  const api = {
    async run_day_rollover() {
      env.events.push("rollover");
      if (env.slowMs) await tick(env.slowMs);                 // 起動時処理に時間がかかる場合(待つ側が、本当に待つかを確かめる)
      if (env.failRollover > 0) { env.failRollover--; throw new Error("失敗"); }
      return { ok: true, sabori_applied: [] };
    },
  };
  const w = startDayWatcher({
    api, today: () => env.day, now: () => env.now,
    isIdle: () => env.idle,
    refresh: async () => { env.events.push("refresh"); },
    onDayChanged: (d) => { env.events.push(`day:${d}`); env.dayChanged.push(d); },
    onRolled: (r) => { env.events.push("rolled"); env.rolled.push(r); },
    doc: document, win, timers, retryMs: 3_000,
  });
  env.w = w;
  const alive = () => env.timeouts.filter((x) => x.alive);
  env.alive = alive;
  // いま予約されているタイマーのうち、いちばん新しいものを鳴らす(鳴らすと、そのタイマーは終わる)
  env.fire = async () => { const t = alive().pop(); assert.ok(t, "鳴らせるタイマーが無い"); t.alive = false; t.fn(); await settle(); };
  // 再試行のタイマー(3秒)を鳴らす
  env.fireRetry = async () => { const t = alive().find((x) => x.ms === 3_000); assert.ok(t, "再試行の予約が無い"); t.alive = false; t.fn(); await settle(); };
  return env;
}
const settle = async () => { await tick(); await tick(); await tick(); };
const cleanup = (env) => { env.w.stop(); };
const count = (env, name) => env.events.filter((x) => x === name).length;

test("日付が同じなら、何もしない(日付の入れ替えも、起動時処理のやり直しも、画面の更新もしない)", async () => {
  const e = setup();
  await e.w.check(); await settle();
  assert.deepEqual(e.events, []);
  cleanup(e);
});

test("日付が変わったら、①見出しの日付を入れ替え → ②起動時処理をやり直し → ③画面を更新する(この順で、1回だけ)", async () => {
  const e = setup();
  e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.deepEqual(e.events, ["day:2026-11-11", "rollover", "rolled", "refresh"]);
  assert.deepEqual(e.w.state.dataPending, false);
  assert.equal(e.w.state.viewPending, false);
  assert.equal(e.w.state.lastDay, "2026-11-11");
  assert.equal(e.w.state.shownDay, "2026-11-11");
  await e.w.check(); await settle();
  assert.equal(count(e, "rollover"), 1, "同じ日なのに、またやり直した");
  assert.equal(e.dayChanged.length, 1, "同じ日なのに、日付をまた入れ替えた");
  e.day = "2026-11-12";                                   // さらに翌日 → もう一度
  await e.w.check(); await settle();
  assert.deepEqual([count(e, "rollover"), count(e, "refresh"), e.dayChanged.length], [2, 2, 2]);
  cleanup(e);
});

test("見出しの日付の入れ替えは、起動時処理を待たない(起動時処理が失敗していても、画面の日付は新しくなる)", async () => {
  const e = setup();
  e.failRollover = 99; e.day = "2026-11-11";
  const spy = console.error; console.error = () => {};
  try { await e.w.check(); await settle(); } finally { console.error = spy; }
  assert.deepEqual(e.dayChanged, ["2026-11-11"]);
  assert.equal(e.w.state.dataPending, true);
  cleanup(e);
});

test("ポップアップが開いている・入力中(idle でない)なら、起動時処理は進めるが、画面の更新は待つ。使い終わったら更新する", async () => {
  const e = setup();
  e.idle = false; e.day = "2026-11-11";
  await e.w.check(); await settle();
  assert.deepEqual([count(e, "rollover"), count(e, "refresh")], [1, 0]);
  assert.equal(e.w.state.viewPending, true);
  await e.fireRetry();                                    // まだ使用中 → また待つ
  assert.equal(count(e, "refresh"), 0);
  e.idle = true;
  await e.fireRetry();
  assert.deepEqual([count(e, "rollover"), count(e, "refresh")], [1, 1]);
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
  assert.equal(count(e, "refresh"), 0, "新しく描かれたのに、もう一度描き直した");
  // 起動時処理が済む前の viewRendered では、保留は消えない(まだ、古い日付のデータで描かれたかもしれない)
  const f = setup();
  f.failRollover = 1; f.day = "2026-11-11";
  const spy = console.error; console.error = () => {};
  try {
    await f.w.check(); await settle();
    f.w.viewRendered();
    assert.equal(f.w.state.dataPending, true);
    await f.fireRetry();
    assert.deepEqual([count(f, "rollover"), count(f, "refresh")], [2, 1]);
  } finally { console.error = spy; }
  cleanup(e); cleanup(f);
});

test("起動時処理が失敗したら、再試行を予約して、直ったら進める(画面は、成功してから更新する)", async () => {
  const e = setup();
  e.failRollover = 2; e.day = "2026-11-11";
  const spy = console.error; console.error = () => {};
  try {
    await e.w.check(); await settle();
    assert.deepEqual([count(e, "rollover"), count(e, "refresh")], [1, 0]);
    assert.equal(e.w.state.dataPending, true);
    await e.fireRetry();
    assert.deepEqual([count(e, "rollover"), count(e, "refresh")], [2, 0]);
    await e.fireRetry();
    assert.deepEqual([count(e, "rollover"), count(e, "refresh"), e.rolled.length], [3, 1, 1]);
  } finally { console.error = spy; }
  cleanup(e);
});

test("同時に呼ばれても、起動時処理は1回だけ(処理中は、重ならない)。あとから呼んだ側も、処理が済むまで待てる", async () => {
  const e = setup();
  e.day = "2026-11-11";
  await Promise.all([e.w.check(), e.w.check(), e.w.check()]); await settle();
  assert.equal(count(e, "rollover"), 1);
  // check() の Promise は、起動時処理が済んでから解決する(app.js の navigate が、これを待ってから新しいタブを描く)
  const f = setup();
  f.day = "2026-11-11"; f.slowMs = 30;
  await f.w.check();
  assert.ok(f.events.includes("rolled"), "check() が、起動時処理の前に解決した");
  // 処理中に、あとから呼んだ側も、同じ処理が済むまで待つ(二重に始めない)
  const g = setup();
  g.day = "2026-11-11"; g.slowMs = 30;
  const first = g.w.check();
  await tick(5);
  await g.w.check();
  assert.ok(g.events.includes("rolled"), "処理中に呼んだ check() が、処理の前に解決した");
  await first;
  assert.equal(count(g, "rollover"), 1);
  cleanup(g);
  cleanup(e); cleanup(f);
});

test("見張りのきっかけ: 画面が再び見えたとき / ウィンドウのフォーカス / pageshow / 0 時のタイマー。見えなくなったときは、動かない", async () => {
  const e = setup();
  e.day = "2026-11-11";
  const vis = (state) => { Object.defineProperty(document, "visibilityState", { value: state, configurable: true }); document.dispatchEvent(new window.Event("visibilitychange")); };
  vis("hidden"); await settle();
  assert.equal(count(e, "rollover"), 0, "見えなくなっただけで動いた");
  vis("visible"); await settle();                          // 画面が再び見えた
  assert.equal(count(e, "rollover"), 1);
  e.day = "2026-11-12";
  [...e.winListeners.focus][0](); await settle();          // ウィンドウのフォーカス
  assert.equal(count(e, "rollover"), 2);
  e.day = "2026-11-13";
  [...e.winListeners.pageshow][0](); await settle();       // ページが戻ってきたとき
  assert.equal(count(e, "rollover"), 3);
  e.day = "2026-11-14";
  await e.fire(); await settle();                          // 0 時のタイマー
  assert.equal(count(e, "rollover"), 4);
  cleanup(e);
});

test("60 秒ごとの確認(setInterval)は、無い。タイマーは setTimeout が 1 つだけ(張り直すときは、前のを消す)", async () => {
  const src = readFileSync(new URL("../ui/js/components/dayWatcher.js", import.meta.url), "utf8");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /setInterval/, "setInterval が残っている");
  const e = setup();
  assert.equal(e.alive().length, 1, "起動直後に予約されているタイマーが、1 つでない");
  for (let i = 0; i < 5; i++) { await e.w.check(); await settle(); }
  assert.equal(e.alive().length, 1, "確認のたびに、タイマーが増えた");
  cleanup(e);
  assert.equal(e.alive().length, 0);
});

// ── 次の 0 時までの残りの計算 ──

test("msUntilNextMidnight: どの日・どの時刻でも、「次の日の現地 0:00 ちょうど」に着く(夏時間の日を含む。実行中のタイムゾーンで確かめる)", () => {
  const times = [[0, 0, 0, 0], [0, 30, 0, 0], [1, 59, 59, 999], [2, 30, 0, 0], [12, 0, 0, 0], [23, 59, 59, 999]];
  let n = 0;
  for (let doy = 0; doy < 366; doy++) {
    for (const [h, mi, s, ms] of times) {
      const now = new Date(2026, 0, 1 + doy, h, mi, s, ms);
      if (now.getHours() !== h) continue;                  // その日に存在しない時刻(夏時間の切り替え)は、飛ばす
      const left = msUntilNextMidnight(now);
      const at = new Date(now.getTime() + left);
      const expected = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      assert.equal(at.getTime(), expected.getTime(), `${now.toString()} → ${at.toString()}`);
      assert.deepEqual([at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds()], [0, 0, 0, 0]);
      assert.ok(left > 0 && left <= 25 * HOUR, `${left}`);
      n++;
    }
  }
  assert.ok(n > 2000);
});

test("msUntilNextMidnight: 夏時間の日は 24 時間ではない(その地域で実行しているときだけ確かめる)", () => {
  const cases = {
    "America/Los_Angeles": [[new Date(2026, 10, 1, 0, 30), 24.5 * HOUR], [new Date(2026, 2, 8, 0, 30), 22.5 * HOUR]], // 11/1 は 25 時間・3/8 は 23 時間の日
    "Pacific/Auckland": [[new Date(2026, 3, 5, 0, 30), 24.5 * HOUR]],                                                  // 4/5 は 25 時間の日
  };
  const list = cases[localTz];
  if (!list) return;                                                                                                   // 夏時間の無い地域では、上のテストが全日を確かめている
  for (const [now, expected] of list) assert.equal(msUntilNextMidnight(now), expected);
});

test("nextWatchDelay: 0 時の少しあとに鳴らす。ただし、1 回のタイマーは最長 1 時間", () => {
  assert.equal(MAX_WAIT_MS, HOUR);
  assert.equal(nextWatchDelay(new Date(2026, 10, 10, 23, 59, 59, 500)), 500 + MARGIN_MS);   // 0 時の 0.5 秒前 → 0 時の 1.5 秒後
  assert.equal(nextWatchDelay(new Date(2026, 10, 10, 23, 30, 0, 0)), 30 * 60_000 + MARGIN_MS);
  assert.equal(nextWatchDelay(new Date(2026, 10, 10, 10, 0, 0, 0)), HOUR, "遠いときは、1 時間で刻む");
  assert.ok(MARGIN_MS >= 1000 && MARGIN_MS <= 2000, "0 時のあと 1〜2 秒に張る");
});

test("タイマー: 起動時は、次の 0 時の少しあとに予約する。長いときは 1 時間ずつ刻み、鳴るたびに今日を取り直して、日付が変わった最初の1回で更新する", async () => {
  const e = setup({ day: "2026-11-10", now: new Date(2026, 10, 10, 10, 0, 0) });
  assert.equal(e.alive()[0].ms, HOUR);
  // 10:00 から、タイマーが鳴るたびに時計を進める(鳴る = 予約した時間が過ぎた)。0 時を過ぎるまで、更新は起きない
  let fires = 0, maxMs = 0;
  while (e.day === "2026-11-10" && fires < 30) {
    const t = e.alive()[0];
    maxMs = Math.max(maxMs, t.ms);
    e.now = new Date(e.now.getTime() + t.ms);
    const crossed = e.now.getDate() !== 10;
    if (crossed) e.day = "2026-11-11";
    await e.fire(); fires++;
    if (!crossed) assert.equal(count(e, "rollover"), 0, `0 時の前に更新した(${e.now})`);
  }
  assert.ok(maxMs <= HOUR, "1 時間より長いタイマーがある");
  assert.deepEqual([count(e, "rollover"), count(e, "refresh"), e.dayChanged], [1, 1, ["2026-11-11"]]);
  assert.ok(fires >= 13 && fires <= 15, `10:00 → 0 時は、1 時間刻みで約 14 回のはず: ${fires}`);
  // 張り直したタイマーは、また次の 0 時へ(= 翌日の 1 時間後以内)
  assert.ok(e.alive()[0].ms <= HOUR);
  cleanup(e);
});

test("タイマーが早く鳴っても(時計の変更・夏時間)、まだ同じ日なら、更新せずに張り直すだけ。残りが短ければ、短く張る", async () => {
  const e = setup({ day: "2026-11-10", now: new Date(2026, 10, 10, 23, 59, 0) });
  assert.equal(e.alive()[0].ms, 60_000 + MARGIN_MS);
  e.now = new Date(2026, 10, 10, 23, 59, 30);              // 予約より早く鳴った(まだ 10 日)
  await e.fire();
  assert.equal(count(e, "rollover"), 0);
  assert.equal(e.alive().length, 1);
  assert.equal(e.alive()[0].ms, 30_000 + MARGIN_MS, "残りに合わせて、張り直していない");
  e.now = new Date(2026, 10, 11, 0, 0, 2); e.day = "2026-11-11";
  await e.fire();
  assert.equal(count(e, "rollover"), 1);
  cleanup(e);
});

test("スリープなどで大きく遅れて鳴っても、1回の更新で追いつく(何日ぶんでも、更新は1回)", async () => {
  const e = setup({ day: "2026-11-10", now: new Date(2026, 10, 10, 22, 0, 0) });
  e.now = new Date(2026, 10, 14, 8, 0, 0); e.day = "2026-11-14";   // 4日後に目覚めた
  await e.fire();
  assert.deepEqual([count(e, "rollover"), e.dayChanged], [1, ["2026-11-14"]]);
  cleanup(e);
});

test("タイマーは、すべて unref する(app.js を読み込むテストが、プロセスの終了を妨げられない)", async () => {
  const e = setup();
  e.day = "2026-11-11"; e.failRollover = 1;
  const spy = console.error; console.error = () => {};
  try { await e.w.check(); await settle(); } finally { console.error = spy; }   // 起動時のタイマー + 張り直し + 再試行
  assert.ok(e.timeouts.length >= 3);
  assert.equal(e.unrefs, e.timeouts.length, "unref していないタイマーがある");
  cleanup(e);
});

test("stop(): タイマー・イベントの登録を、すべて片付ける。そのあとは、何もしない", async () => {
  const e = setup();
  e.day = "2026-11-11";
  e.w.stop();
  assert.equal(e.alive().length, 0);
  assert.equal(e.winListeners.pageshow.size, 0);
  assert.equal(e.winListeners.focus.size, 0);
  await e.w.check(); await settle();
  assert.deepEqual(e.events, [], "stop のあとに動いた");
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  document.dispatchEvent(new window.Event("visibilitychange")); await settle();
  assert.deepEqual(e.events, []);
  assert.equal(e.alive().length, 0, "stop のあとに、タイマーを張った");
});

test("計測中の保留の仕組みは、無い(isBusy・subscribeBusy・お知らせ)。理由は、コードの注釈にある", () => {
  const src = readFileSync(new URL("../ui/js/components/dayWatcher.js", import.meta.url), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  for (const word of ["isBusy", "subscribeBusy", "day-notice", "getNoticeHost", "noticeDismissed"]) assert.doesNotMatch(code, new RegExp(word), `${word} が残っている`);
  assert.match(src, /保留しない理由/);
  assert.match(src, /_refundSaboriIfNeeded/);
  assert.equal(document.querySelector(".day-notice"), null);
});
