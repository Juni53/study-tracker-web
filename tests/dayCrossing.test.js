// 「計測が日付をまたいでいる」状態(store/dayCrossing.js)と、お知らせ部品(components/crossingNotice.js)と、開始時刻の表記(views/timer.js の startLabel)。
// アプリごと動かす確認(全ページに出る・閉じる・保存/リセットで消える)は、dayrollover.app.test.js にある。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { setClock } from "../ui/js/core/dates.js";

setupDom("<!DOCTYPE html><body></body>");
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { stopwatch } = await import("../ui/js/store/stopwatch.js");
const { isPending, deriveCrossing, getCrossing, refreshCrossing, subscribeCrossing } = await import("../ui/js/store/dayCrossing.js");
const { startCrossingNotice, noticeBody, NOTICE_TITLE, NOTICE_LEGEND } = await import("../ui/js/components/crossingNotice.js");
const { startLabel } = await import("../ui/js/views/timer.js");

const at = (m, d, h = 10, mi = 0) => new Date(2026, m - 1, d, h, mi, 0);
const NOW = { d: at(12, 14, 23, 5) };
setClock(() => NOW.d);
const clean = () => { stopwatch.reset(); stopwatch.pomodoroReset(); refreshCrossing(); };

test("isPending: 計測の途中(開始日あり)で、開始日が今日より前なら、確定前。規則は、この関数だけ", () => {
  assert.equal(isPending(null, "2026-12-15"), false);
  assert.equal(isPending("2026-12-15", "2026-12-15"), false, "同じ日は、またいでいない");
  assert.equal(isPending("2026-12-14", "2026-12-15"), true);
  assert.equal(isPending("2026-11-30", "2026-12-01"), true, "月をまたぐ");
  assert.equal(isPending("2026-12-31", "2027-01-01"), true, "年をまたぐ");
  assert.equal(isPending("2026-12-14", "2026-12-14"), false);
  const src = readFileSync(new URL("../ui/js/store/dayCrossing.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.equal((src.match(/startDate < today/g) || []).length, 1, "規則(startDate < today)が、1 行だけでなく散らばっている");
});

test("deriveCrossing: またいでいなければ null。またいでいれば、開始日・開始時刻・pendingDates = [開始日]", () => {
  assert.equal(deriveCrossing({ startDate: null, startTime: null }, "2026-12-15"), null);
  assert.equal(deriveCrossing({ startDate: "2026-12-15", startTime: "00:10" }, "2026-12-15"), null);
  assert.deepEqual(deriveCrossing({ startDate: "2026-12-14", startTime: "23:05" }, "2026-12-15"),
    { startDate: "2026-12-14", startTime: "23:05", pendingDates: ["2026-12-14"] });
});

test("状態の更新: 開始 → 日付が変わる → 一時停止しても続く → リセットで消える。変わったときだけ、知らせる", () => {
  clean();
  const seen = [];
  const off = subscribeCrossing((c) => seen.push(c ? `${c.startDate} ${c.startTime}` : null));
  NOW.d = at(12, 14, 23, 5);
  stopwatch.start();                                   // 12/14 23:05 に開始(同じ日 → またいでいない)
  assert.equal(stopwatch.startDate, "2026-12-14");
  assert.equal(stopwatch.startTime, "23:05", "開始時刻が、共通の時計から取られていない");
  assert.equal(getCrossing(), null);
  NOW.d = at(12, 15, 0, 42);
  assert.equal(refreshCrossing(), true, "日付が変わったのに、状態が変わらない");   // app.js は、日付の見張り(onDayChanged)から呼ぶ
  assert.deepEqual(getCrossing(), { startDate: "2026-12-14", startTime: "23:05", pendingDates: ["2026-12-14"] });
  assert.equal(refreshCrossing(), false, "変わっていないのに、また知らせた");
  stopwatch.pause();                                   // 一時停止しても、またいだまま・開始時刻も最初のまま
  assert.equal(getCrossing().startTime, "23:05");
  stopwatch.start();
  assert.equal(getCrossing().startDate, "2026-12-14");
  stopwatch.reset();                                   // リセット(保存後も、同じ)で消える
  assert.equal(getCrossing(), null);
  assert.deepEqual(seen, ["2026-12-14 23:05", null]);
  off();
  clean();
});

test("計測が止まっていても(一時停止中)、日付が変われば、またいでいる状態になる(ストップウォッチの購読に頼らない)", () => {
  clean();
  NOW.d = at(12, 14, 22, 0);
  stopwatch.start(); stopwatch.pause();
  assert.equal(getCrossing(), null);
  NOW.d = at(12, 15, 0, 5);
  refreshCrossing();
  assert.equal(getCrossing()?.startDate, "2026-12-14");
  clean();
});

test("ストップウォッチのストアは、new Date() を直接使わない(開始日・開始時刻は、共通の時計)", () => {
  const src = readFileSync(new URL("../ui/js/store/stopwatch.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /new Date\(\)/);
});

// ── 開始時刻の表記 ──
test("startLabel: 同じ日は「開始 23:05」、日をまたぐ間は「11/12 23:05 開始」。計測が無ければ空", () => {
  assert.equal(startLabel({ startDate: null, startTime: null }, null), "");
  assert.equal(startLabel({ startDate: "2026-11-12", startTime: "23:05" }, null), "開始 23:05");
  assert.equal(startLabel({ startDate: "2026-11-12", startTime: "23:05" }, { startDate: "2026-11-12" }), "11/12 23:05 開始");
  assert.equal(startLabel({ startDate: "2027-01-02", startTime: "00:05" }, { startDate: "2027-01-02" }), "01/02 00:05 開始", "月・日は 0 埋め");
});

// ── お知らせ ──
function fakeStore(initial = null) {
  const s = { c: initial, cbs: new Set() };
  s.get = () => s.c;
  s.sub = (fn) => { s.cbs.add(fn); return () => s.cbs.delete(fn); };
  s.set = (c) => { s.c = c; s.cbs.forEach((fn) => fn(c)); };
  return s;
}
const C = (date = "2026-11-12", time = "23:05") => ({ startDate: date, startTime: time, pendingDates: [date] });
const cards = () => [...document.querySelectorAll(".crossing-notice")];

test("お知らせ: 文言は確定どおり(タイトル・本文の日付と時刻・凡例・閉じる)。「保留」という言葉は使わない", () => {
  document.body.innerHTML = "";
  const st = fakeStore(C());
  const n = startCrossingNotice({ getCrossing: st.get, subscribeCrossing: st.sub });
  assert.equal(cards().length, 1);
  const el = cards()[0];
  assert.equal(el.querySelector(".nt-text").textContent, "計測が日付をまたいでいます");
  assert.equal(el.querySelector(".nt-sub").textContent, "11/12 23:05 に開始。保存すると、11/12 の記録になります。");
  assert.equal(el.querySelector(".nt-legend").textContent, "斜線の部分は、保存すると変わる可能性があります。");
  assert.ok(el.querySelector(".nt-legend .pend-swatch.pend"), "斜線の見本がない");
  assert.equal(el.querySelector('[data-crossing="close"]').textContent, "閉じる");
  assert.equal(el.getAttribute("role"), "status");
  assert.ok(el.closest(".notice-host"), "右下の入れ物(noticeHost)に入っていない");
  assert.doesNotMatch(el.textContent, /保留/);
  assert.equal([NOTICE_TITLE, NOTICE_LEGEND].length, 2);
  assert.equal(noticeBody(C("2027-01-02", "00:05")), "01/02 00:05 に開始。保存すると、01/02 の記録になります。");
  n.stop();
});

test("お知らせ: 保存・リセットで(状態が null に戻ると)消える。同じ計測では、2つ出ない。HTML は、日付・時刻をそのまま文字として出す", () => {
  document.body.innerHTML = "";
  const st = fakeStore(null);
  const n = startCrossingNotice({ getCrossing: st.get, subscribeCrossing: st.sub });
  assert.equal(cards().length, 0, "またいでいないのに、出ている");
  st.set(C()); st.set(C()); st.set(C());
  assert.equal(cards().length, 1);
  st.set(null);
  assert.equal(cards().length, 0, "リセットしたのに、消えない");
  st.set(C("2026-11-12", "<b>x</b>"));
  assert.equal(cards()[0].querySelector(".nt-sub").innerHTML.includes("<b>"), false, "文字が、HTML として解釈された");
  n.stop();
  assert.equal(cards().length, 0, "stop() のあとも残っている");
});

test("お知らせ: 「閉じる」で隠れる。同じ計測のあいだは、また出ない。計測が終わって、新しくまたいだときは、また出る", () => {
  document.body.innerHTML = "";
  const st = fakeStore(C());
  const n = startCrossingNotice({ getCrossing: st.get, subscribeCrossing: st.sub });
  cards()[0].querySelector('[data-crossing="close"]').click();
  assert.equal(cards().length, 0);
  st.set(C()); st.set(C());                                          // 同じ計測(毎秒の通知など)
  assert.equal(cards().length, 0, "閉じたのに、また出た");
  st.set(null);                                                      // 保存
  st.set(C("2026-11-13", "22:40"));                                  // 次の計測が、また日をまたいだ
  assert.equal(cards().length, 1, "新しくまたいだのに、出ない");
  assert.match(cards()[0].textContent, /11\/13 22:40 に開始/);
  cards()[0].querySelector('[data-crossing="close"]').click();
  st.set(null); st.set(C("2026-11-13", "22:40"));                    // 同じ開始日・時刻でも、いったん終わったあとは、新しい計測
  assert.equal(cards().length, 1, "終わってから、また同じ時刻でまたいだのに、出ない");
  n.stop();
});

test("お知らせ: 開始日・開始時刻が違えば、別の計測として、カードを入れ替える(1つだけ)", () => {
  document.body.innerHTML = "";
  const st = fakeStore(C("2026-11-12", "23:05"));
  const n = startCrossingNotice({ getCrossing: st.get, subscribeCrossing: st.sub });
  st.set(C("2026-11-12", "23:10"));
  assert.equal(cards().length, 1);
  assert.match(cards()[0].textContent, /23:10 に開始/);
  n.stop();
});

test("お知らせの CSS: 斜線は仕様どおり(135 度・1.5px の線・6px の間隔)で、下に背景色(--paper-rgb)のオーバーレイがある。ダークテーマでも見える色(--ink-rgb)。見本は 26×12px", () => {
  const css = readFileSync(new URL("../ui/css/components.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.pend\{position:relative;\}/);
  assert.match(css, /\.pend::after\{[^}]*inset:0; pointer-events:none;[^}]*repeating-linear-gradient\(135deg, rgba\(var\(--ink-rgb\),var\(--pend-line-a\)\) 0 1\.5px, transparent 1\.5px 6px\),[^}]*rgba\(var\(--paper-rgb\),var\(--pend-wash-a\)\)/);
  assert.match(css, /\.pend-swatch\{[^}]*width:26px; height:12px;/);
  const tokens = readFileSync(new URL("../ui/css/tokens.css", import.meta.url), "utf8");
  assert.match(tokens, /--ink-rgb:34,37,43/, "ライトの線の色(34,37,43)が、仕様と違う");
  assert.match(tokens, /--ink-rgb:237,234,224/, "ダークでは、--ink-rgb が明るい色に変わる(線の色が反転する)");
  void tick;
});
