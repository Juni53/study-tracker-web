// 日付が変わったとき・計測中の再読み込み: app.js ごと動かして確かめる(jsdom)。
// 時計を進めながら、さぼり券が使われるか(= 起動時処理がやり直されたか)・画面が描き直されたか・見出しの日付が入れ替わったか・
// 描き直しの経路(クロスフェード / すぐに入れ替え)が正しいかを見る。計測中でも、保留しない(2026-11-02 の再設計)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { setClock } from "../ui/js/core/dates.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
const REDUCE = { on: true };                                        // 「動きを減らす」設定(既定は、動かさない = 即時の経路)
globalThis.matchMedia = (q) => ({ matches: REDUCE.on && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const NOW = { d: new Date(2026, 10, 10, 10, 0, 0) };                 // 2026-11-10 10:00(テストから進める)
setClock(() => NOW.d);
const goTo = (m, d, h = 10) => { NOW.d = new Date(2026, m - 1, d, h, 0, 0); };

const { api } = await import("../ui/js/api.js");
const { stopwatch } = await import("../ui/js/store/stopwatch.js");
await import("../ui/js/app.js");

const until = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };
const h1 = () => document.querySelector("#content h1");
const owned = async () => (await api.get_shop()).sabori.owned;
const wake = () => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new window.Event("visibilitychange")); };
const notice = () => document.querySelector(".day-notice");

// 準備: 11/8〜11/10 に16時間ずつ勉強(ポイントをためる)→ さぼり券を2枚買う
await until(() => h1()?.textContent === "ホーム", "ホーム");
await api.add_record("2026-11-09", "16h", "x", [], [], "manual", 3, null);
await api.add_record("2026-11-10", "16h", "x", [], [], "manual", 3, null);
await api.add_record("2026-11-08", "16h", "x", [], [], "manual", 3, null);
const buyTwo = async () => { for (let i = 0; i < 2; i++) assert.equal((await api.buy_sabori_ticket()).ok, true); };
await buyTwo();
assert.equal(await owned(), 2);

test("日付が変わったら(開いたまま)、起動時処理がやり直されて(さぼり券が使われる)、画面が描き直される", async () => {
  const before = h1();
  goTo(11, 13);                                      // 3日後。11/11・11/12 は、勉強なし(アプリは開いたまま)
  wake();
  await until(() => h1() && h1() !== before, "画面の描き直し");
  assert.equal(h1().textContent, "ホーム", "描き直したあとの画面が違う");
  assert.equal(await owned(), 0, "さぼり券が使われていない(起動時処理がやり直されていない)");
  assert.equal(notice(), null);
});

test("ストップウォッチが動いている間も、保留しない: すぐに起動時処理がやり直され、画面が描き直され、計測は止まらず、お知らせは出ない", async () => {
  await buyTwo();
  const before = h1();
  goTo(11, 16);                                      // 11/14・11/15 が、勉強なし
  stopwatch.start();
  wake();
  await until(() => h1() !== before, "画面の描き直し");
  assert.equal(await owned(), 0, "計測中なのに、さぼり券が使われていない(起動時処理が保留されている)");
  assert.equal(stopwatch.running, true, "描き直しで、ストップウォッチが止まった");
  assert.equal(notice(), null, "保留のお知らせが出ている");
  assert.equal(document.querySelector(".day-notice"), null);
  assert.doesNotMatch(document.body.textContent, /更新を保留/);
  stopwatch.reset();
});

test("ポップアップが開いている間は、起動時処理は進めるが、画面は描き直さない。閉じて、もう一度見たら、描き直す", async () => {
  await buyTwo();
  const before = h1();
  const modal = document.createElement("div");
  modal.className = "modal-overlay open";
  document.body.appendChild(modal);
  goTo(11, 19);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  assert.equal(await owned(), 0, "起動時処理が進まない");
  await tick(100);
  assert.equal(h1(), before, "ポップアップが開いているのに、画面が描き直された");
  modal.remove();
  wake();
  await until(() => h1() !== before, "ポップアップを閉じたあとの描き直し");
});

test("タブを切り替えたあとは、もう描き直さない(新しい日付で描かれているため)", async () => {
  await api.buy_sabori_ticket();
  const modal = document.createElement("div");
  modal.className = "modal-overlay open";
  document.body.appendChild(modal);
  goTo(11, 22);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  document.querySelector('#items .item[data-key="stats"]').click();         // 使用中に、別のタブへ
  await until(() => h1()?.textContent === "統計", "統計タブ");
  const statsH1 = h1();
  modal.remove();
  wake();
  await tick(200);
  assert.equal(h1(), statsH1, "切り替え済みなのに、もう一度描き直した");
  document.querySelector('#items .item[data-key="home"]').click();
  await until(() => h1()?.textContent === "ホーム", "ホーム");
});

test("入力欄に入力している最中は、起動時処理は進めるが、画面は描き直さない。入力が終わったら、描き直す", async () => {
  await api.buy_sabori_ticket();
  const before = h1();
  const input = document.createElement("input");
  document.querySelector("#content").appendChild(input);
  input.focus();
  assert.equal(document.activeElement, input);
  goTo(11, 25);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  assert.equal(await owned(), 0, "起動時処理が進まない");
  await tick(100);
  assert.equal(h1(), before, "入力中なのに、画面が描き直された(入力が消える)");
  input.blur();
  wake();
  await until(() => h1() !== before, "入力が終わったあとの描き直し");
});

test("計測の途中に再読み込みしようとすると、ブラウザの確認が出る(beforeunload)。計測が無ければ出ない", () => {
  stopwatch.reset(); stopwatch.pomodoroReset();
  const ask = () => { const ev = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(ev); return ev; };
  assert.equal(ask().defaultPrevented, false, "計測が無いのに、確認が出る");
  stopwatch.start();
  try {
    const ev = ask();
    assert.equal(ev.defaultPrevented, true, "計測中なのに、確認が出ない");
    stopwatch.pause();
    assert.equal(ask().defaultPrevented, true, "一時停止中(未保存)でも、確認が出る");
  } finally { stopwatch.reset(); }
  assert.equal(ask().defaultPrevented, false);
});

// ───────── 見出しの日付・描き直しの経路(2026-11-02 の再設計 段階 A) ─────────
const untilAsync = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };
const dateText = () => document.querySelector("#content [data-today-date]")?.textContent;
const ptsNumber = (sel) => Number(document.querySelector(sel).textContent.replace(/[^0-9.\-]/g, ""));
const go = async (key, title) => { document.querySelector(`#items .item[data-key="${key}"]`).click(); await until(() => h1()?.textContent === title, title); };
// 偽の View Transitions: 描き直しの関数を呼んで、その終わりを updateCallbackDone で返す(ブラウザの動きと同じ形)
function installFakeVt({ throwFirst = false, onCall = null } = {}) {
  const log = { calls: 0 };
  document.startViewTransition = (cb) => {
    log.calls++;
    if (onCall) onCall();
    if (throwFirst) { throwFirst = false; throw new Error("InvalidStateError(偽)"); }
    const done = (async () => { await cb(); })();
    return { updateCallbackDone: done, finished: done, ready: done };
  };
  return log;
}
const removeFakeVt = () => { delete document.startViewTransition; };

test("日付が変わったら、描き直した画面の見出しの日付も、新しい日付になっている(ホーム)", async () => {
  await until(() => h1()?.textContent === "ホーム", "ホーム");
  assert.match(dateText(), /^2026-11-25 \(水\)$|^\d{4}-\d{2}-\d{2} \(.\)$/);
  const before = h1();
  goTo(11, 28); wake();                              // 11/28 は土曜日
  await until(() => h1() !== before, "画面の描き直し");
  assert.equal(dateText(), "2026-11-28 (土)");
});

test("ストップウォッチのタブは、描き直さない: 日付の文字だけが変わり、計測もポモドーロも止まらない。ポイント残高は、新しくなる", async () => {
  await go("timer", "ストップウォッチ");
  const vt = installFakeVt(); REDUCE.on = false;
  try {
    stopwatch.start();
    const h = h1(), time = document.querySelector("#swTime");
    assert.equal(dateText(), "2026-11-28 (土)");
    const before = await api.get_points_balance();
    goTo(12, 1); wake();                             // 12/1 は火曜日。ポイントの消失がかかる(さぼり券は無い)
    await until(() => dateText() === "2026-12-01 (火)", "日付の文字の入れ替え");
    await tick(150);
    assert.equal(h1(), h, "ストップウォッチのタブが、描き直された");
    assert.equal(document.querySelector("#swTime"), time, "ストップウォッチの表示が、作り直された");
    assert.equal(stopwatch.running, true);
    assert.equal(vt.calls, 0, "描き直さないのに、クロスフェードを始めた");
    const after = await api.get_points_balance();
    assert.ok(after < before, `ポイントの消失がかかっていない(前提): ${before} → ${after}`);
    // 数え上げの演出のあとで、見出しのポイントが、新しい残高になる(描き直さなくても)
    await untilAsync(async () => ptsNumber("#ptsTop") === (await api.get_points_balance()), "見出しのポイントが新しい残高になる");
    assert.equal(notice(), null);
  } finally { stopwatch.reset(); REDUCE.on = true; removeFakeVt(); }
  await go("home", "ホーム");
});

test("フィードバックのタブにも、日付がある(描き直さずに、文字だけ変わる)。そのタブが無ければ、このテストは何もしない", async () => {
  const item = document.querySelector('#items .item[data-key="feedback"]');
  if (!item) return;                                  // フィードバックの URL が config.js に無い環境
  await go("feedback", "フィードバック");
  const h = h1();
  assert.equal(dateText(), "2026-12-01 (火)");
  goTo(12, 2); wake();
  await until(() => dateText() === "2026-12-02 (水)", "日付の文字の入れ替え");
  assert.equal(h1(), h, "フィードバックのタブが、描き直された");
  await go("home", "ホーム");
});

test("描き直しはクロスフェード(View Transitions)で行う: 対応していて、動きを減らす設定でないとき。見ている位置も保つ", async () => {
  await until(() => h1()?.textContent === "ホーム", "ホーム");
  const vt = installFakeVt(); REDUCE.on = false;
  const writes = []; let top = 321;
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: { get scrollTop() { return top; }, set scrollTop(v) { writes.push(v); top = v; } } });
  try {
    const before = h1();
    goTo(12, 4); wake();                              // 12/4 は金曜日
    await until(() => h1() !== before, "画面の描き直し");
    assert.equal(vt.calls, 1, "クロスフェードを、1回だけ始めるはず");
    assert.equal(dateText(), "2026-12-04 (金)");
    assert.deepEqual(writes, [321], "見ている位置を、元に戻していない");
    const content = document.querySelector("#content");
    assert.equal(content.style.visibility, "", "描き直しのあと、画面が隠れたまま");
    assert.equal(content.style.pointerEvents, "", "描き直しのあと、操作できないまま");
  } finally { REDUCE.on = true; removeFakeVt(); delete document.scrollingElement; }
});

test("動きを減らす設定のときは、View Transitions があっても使わず、すぐに入れ替える(アニメーションなし)", async () => {
  const vt = installFakeVt(); REDUCE.on = true;
  try {
    const before = h1();
    goTo(12, 7); wake();
    await until(() => h1() !== before, "画面の描き直し");
    assert.equal(vt.calls, 0, "動きを減らす設定なのに、クロスフェードを始めた");
    assert.equal(dateText(), "2026-12-07 (月)");
  } finally { removeFakeVt(); }
});

test("View Transitions に対応していないブラウザでも、すぐに入れ替えて更新できる", async () => {
  REDUCE.on = false;
  try {
    assert.equal(typeof document.startViewTransition, "undefined");
    const before = h1();
    goTo(12, 8); wake();
    await until(() => h1() !== before, "画面の描き直し");
    assert.equal(dateText(), "2026-12-08 (火)");
  } finally { REDUCE.on = true; }
});

test("クロスフェードを始められなくても(例外)、そのまま描き直して更新する。描き直しは、1回だけ", async () => {
  const vt = installFakeVt({ throwFirst: true }); REDUCE.on = false;
  const spy = console.error; console.error = () => {};
  try {
    const before = h1();
    goTo(12, 9); wake();
    await until(() => h1() !== before, "画面の描き直し");
    assert.equal(vt.calls, 1);
    assert.equal(dateText(), "2026-12-09 (水)");
    assert.equal(document.querySelectorAll("#content h1").length, 1, "画面が二重に描かれた");
  } finally { console.error = spy; REDUCE.on = true; removeFakeVt(); }
});

test("タブを開いたときに、日付が変わっていたら(まだ誰も気づいていなくても)、起動時処理のやり直しが済んでから、新しいタブを描く", async () => {
  await buyTwo();
  assert.equal(await owned(), 2);
  goTo(12, 13);                                       // 12/13(日)。wake() はしない = 見張りは、まだ気づいていない
  document.querySelector('#items .item[data-key="stats"]').click();
  await until(() => h1()?.textContent === "統計", "統計タブ");
  assert.equal(await owned(), 0, "タブを開いたのに、起動時処理がやり直されていない");
  assert.equal(dateText(), "2026-12-13 (日)", "新しいタブの日付が、古いまま");
  await go("home", "ホーム");
});

test("見出しの日付は、全部のタブにある(ポイントの左)。描き直さないタブは、そう宣言している", async () => {
  const order = [];
  for (const key of ["home", "timer", "log", "cal", "exam", "stats", "shop", "settings"]) {
    const item = document.querySelector(`#items .item[data-key="${key}"]`);
    item.click();
    await until(() => document.querySelector("#content .top h1") && item.classList.contains("active"), key);
    await tick(30);
    const right = document.querySelector("#content .top .right");
    const kids = [...right.children];
    assert.ok(kids[0].matches("[data-today-date]"), `${key}: 日付が、見出しの右の先頭(ポイントの左)にない`);
    assert.ok(kids[1]?.classList.contains("pts"), `${key}: 日付のすぐ右に、ポイントがない`);
    order.push(key);
  }
  assert.equal(order.length, 8);
  const timer = await import("../ui/js/views/timer.js");
  const feedback = await import("../ui/js/views/feedback.js");
  assert.equal(timer.refreshOnDayChange, false);
  assert.equal(feedback.refreshOnDayChange, false);
  for (const key of ["home", "log", "cal", "exam", "stats", "shop", "settings"]) {
    const m = await import(`../ui/js/views/${key}.js`);
    assert.notEqual(m.refreshOnDayChange, false, `${key} は、日付が変わったら描き直す画面のはず`);
  }
  await go("home", "ホーム");
});

// ───────── 計測が日付をまたいでいる間の表示(2026-11-02 の再設計 段階 B) ─────────
const crossCards = () => [...document.querySelectorAll(".crossing-notice")];
const at = (m, d, h, mi) => { NOW.d = new Date(2026, m - 1, d, h, mi, 0); };
const openTab = async (key) => {
  const item = document.querySelector(`#items .item[data-key="${key}"]`);
  item.click();
  await until(() => item.classList.contains("active") && document.querySelector("#content .top h1"), key);
  await tick(60);
};

test("計測が日付をまたぐと、全ページの右下に「またいでいます」が出る(ストップウォッチのタブでも)。閉じても続き、保存・リセットで消え、新しくまたぐと、また出る", async () => {
  await openTab("home");
  stopwatch.reset();
  at(12, 14, 23, 5);
  stopwatch.start();                                              // 12/14 23:05 に開始(同じ日)
  assert.equal(crossCards().length, 0, "同じ日なのに、出ている");
  at(12, 15, 0, 42); wake();                                      // 日付が変わった(0:42)
  await until(() => crossCards().length === 1, "お知らせ");
  assert.equal(crossCards()[0].querySelector(".nt-text").textContent, "計測が日付をまたいでいます");
  assert.equal(crossCards()[0].querySelector(".nt-sub").textContent, "12/14 23:05 に開始。保存すると、12/14 の記録になります。");
  assert.doesNotMatch(document.body.textContent, /保留/);
  for (const key of ["timer", "log", "cal", "exam", "stats", "shop", "settings", "home"]) {
    await openTab(key);
    assert.equal(crossCards().length, 1, `${key}: お知らせが出ていない(または、二重に出ている)`);
  }
  crossCards()[0].querySelector('[data-crossing="close"]').click();
  assert.equal(crossCards().length, 0);
  await openTab("stats"); await openTab("home");
  assert.equal(crossCards().length, 0, "閉じたのに、タブを移ったらまた出た");
  assert.equal(stopwatch.running, true);

  stopwatch.reset();                                              // 保存(→ リセット)と同じ
  assert.equal(crossCards().length, 0);
  at(12, 15, 23, 30); stopwatch.start();
  at(12, 16, 0, 10); wake();                                      // 次の計測が、また日をまたいだ
  await until(() => crossCards().length === 1, "新しくまたいだときの、お知らせ");
  assert.match(crossCards()[0].textContent, /12\/15 23:30 に開始/);
  stopwatch.reset();
  assert.equal(crossCards().length, 0);
});

test("ストップウォッチの画面: 開始時刻が出る。同じ日は「開始 23:05」、日をまたぐ間は「12/16 23:05 開始」。一時停止しても最初のまま、リセットで消える", async () => {
  await openTab("timer");
  const label = () => document.querySelector("#swStart").textContent;
  assert.equal(label(), "", "計測が無いのに、開始時刻が出ている");
  at(12, 16, 23, 5);
  stopwatch.start();
  assert.equal(label(), "開始 23:05");
  at(12, 16, 23, 20);
  stopwatch.pause(); stopwatch.start(); stopwatch.pause();
  assert.equal(label(), "開始 23:05", "一時停止・再開で、開始時刻が変わった");
  at(12, 17, 0, 20); wake();                                      // 日付が変わった(計測は止まっている)
  await until(() => label() === "12/16 23:05 開始", "日をまたいだ表記");
  const h = h1();
  await openTab("home"); await openTab("timer");                    // 開いたときから、またいだ表記
  assert.equal(label(), "12/16 23:05 開始");
  assert.notEqual(h1(), h);
  stopwatch.reset();
  assert.equal(label(), "", "リセットしても、開始時刻が残っている");
  await openTab("home");
});

test("週ログ(ホーム)に、開始時刻の表記は付けない", async () => {
  at(12, 17, 23, 5);
  stopwatch.start();
  at(12, 18, 0, 30); wake();
  await until(() => crossCards().length === 1, "お知らせ");
  await openTab("home");
  const log = document.querySelector("#content .log");
  assert.ok(log);
  assert.doesNotMatch(log.textContent, /23:05|計測中|開始/, "週ログに、開始時刻・計測中の表記がある");
  stopwatch.reset();
});

// ───────── 確定前の斜線(2026-11-02 の再設計 段階 C) ─────────
test("計測中に日付が変わると、開いているホームが描き直されて、斜線が出る。計測が終わって開き直すと、消える", async () => {
  await openTab("home");
  stopwatch.reset();
  await until(() => document.querySelectorAll("#content .pend").length === 0, "前のテストの斜線が消える(計測が終わると、開いている画面から消える)");
  at(12, 21, 23, 5);                                              // 12/21(月)23:05 に開始。週の中に 12/21 がある日は、火曜日
  stopwatch.start();
  const before = h1();
  assert.equal(document.querySelectorAll("#content .pend").length, 0, "同じ日なのに、斜線がある");
  at(12, 22, 0, 30); wake();                                      // 12/22(火)0:30
  await until(() => h1() !== before, "ホームの描き直し");
  await until(() => document.querySelector("#content .streak-box.pend"), "連続記録のカードの斜線");
  const rows = [...document.querySelectorAll("#content .lg-row")].filter((r) => r.classList.contains("pend"));
  assert.equal(rows.length, 1);
  assert.match(rows[0].querySelector(".d").textContent, /12\/21/);
  assert.equal(document.querySelectorAll("#content .chart-pending-dot").length, 1, "週間推移に、確定前の点がない");
  assert.equal(stopwatch.running, true);
  for (const key of ["cal", "shop"]) {                              // ほかのタブも、開いたときから斜線
    await openTab(key);
    assert.ok(document.querySelector("#content .pend"), `${key}: 斜線がない`);
  }
  await openTab("home");
  stopwatch.reset();                                              // 保存(→ リセット)と同じ。開いているホームから、斜線が消える(描き直し)
  await until(() => document.querySelectorAll("#content .pend").length === 0, "計測が終わったあとの、斜線の消去");
  assert.equal(document.querySelectorAll("#content [data-pending], #content .chart-pending-dot").length, 0);
});

test("またぎ始め・またぎ終わりの描き直しは、それぞれ 1 回だけ(日付が変わったときに二重に描かない。終わったときに静かに 1 回)", async () => {
  await openTab("home");
  stopwatch.reset();
  await until(() => document.querySelectorAll("#content .pend").length === 0, "前の斜線が消える");
  // 起動時処理を遅くして、「描き直しは、起動時処理が済んだあと」であることを確かめる(先に描くと、古いデータの画面になる)
  const { ready } = await import("../ui/js/api.js");
  const impl = (await ready()).api;
  const origRollover = impl.run_day_rollover;
  const order = [];
  impl.run_day_rollover = async function (...a) { await new Promise((r) => setTimeout(r, 60)); const r = await origRollover.apply(this, a); order.push("rolled"); return r; };
  const vt = installFakeVt({ onCall: () => order.push("redraw") }); REDUCE.on = false;
  try {
    at(12, 23, 23, 5); stopwatch.start();
    at(12, 24, 0, 30); wake();
    await until(() => document.querySelector("#content .streak-box.pend"), "斜線");
    await tick(150);
    assert.deepEqual(order, ["rolled", "redraw"], "描き直しが、起動時処理より先に走った(古いデータの画面になる)");
    assert.equal(vt.calls, 1, "日付が変わったとき、描き直しが 1 回でない(二重に描いた)");
    stopwatch.reset();
    await until(() => document.querySelectorAll("#content .pend").length === 0, "斜線の消去");
    await tick(150);
    assert.equal(vt.calls, 2, "計測が終わったとき、描き直しが 1 回でない");
  } finally { REDUCE.on = true; removeFakeVt(); impl.run_day_rollover = origRollover; }
});
