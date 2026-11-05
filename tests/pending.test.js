// 「確定前」の斜線(段階 C): チャートの描き方と、各画面の対象・対象外。アプリごとの流れ(日付が変わって斜線が出る)は、dayrollover.app.test.js にある。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { setupDom, tick } from "./_dom.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const { renderSmoothChart } = await import("../ui/js/components/chart.js");
const { stopwatch } = await import("../ui/js/store/stopwatch.js");
const { refreshCrossing } = await import("../ui/js/store/dayCrossing.js");

// ───────── チャート ─────────
const VALUES = [60, 120, 90, 200, 150, 0, 0];     // 月〜日
function chart(opts) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  renderSmoothChart(el, VALUES, opts);              // jsdom は幅が 0 → 幅 700 で描く
  return el;
}
const W = 700, padX = 20, n = 7, step = (W - 2 * padX) / (n - 1);
const num = (e, a) => parseFloat(e.getAttribute(a));

test("チャート: 確定前の点は、中空の丸(半径5・塗りは紙色・線は ink で太さ2)で、その点の位置にある", () => {
  const el = chart({ todayIndex: 4, pendingIndex: 2 });
  const dot = el.querySelector(".chart-pending-dot");
  assert.ok(dot, "中空の丸がない");
  assert.deepEqual([dot.getAttribute("r"), dot.getAttribute("fill"), dot.getAttribute("stroke"), dot.getAttribute("stroke-width")], ["5", "var(--paper)", "var(--ink)", "2"]);
  assert.equal(num(dot, "cx"), padX + 2 * step, "点の x が、確定前の日の位置でない");
  assert.equal(el.querySelectorAll(".chart-pending-dot").length, 1);
  // 丸は、線より前面(あとに描く)。帯は、線より背面(先に描く)
  const kids = [...el.querySelector("svg").children].map((c) => c.getAttribute("class") || c.tagName.toLowerCase());
  assert.ok(kids.indexOf("chart-pending-band") < kids.indexOf("chart-line"), `帯が線より前面: ${kids}`);
  assert.ok(kids.lastIndexOf("chart-line") < kids.indexOf("chart-pending-dot"), `丸が線より背面: ${kids}`);
});

test("チャート: その点から次の点までの線だけが破線(5 4)。残りは実線。つなげると、元の曲線と同じ形", () => {
  const el = chart({ todayIndex: 4, pendingIndex: 2 });
  const lines = [...el.querySelectorAll("path.chart-line")];
  assert.equal(lines.length, 3, "実線・破線・実線の 3 本のはず");
  assert.deepEqual(lines.map((l) => l.getAttribute("stroke-dasharray")), [null, "5 4", null]);
  assert.equal(el.querySelectorAll(".chart-pending-line").length, 1);
  for (const l of lines) assert.equal(l.getAttribute("vector-effect"), "non-scaling-stroke");
  // 同じ入力で、確定前なしの曲線: 区間(C…)を、つなげた結果が、同じ
  const plain = chart({ todayIndex: 4 });
  const full = plain.querySelector("path.chart-line").getAttribute("d");
  assert.deepEqual(plain.querySelectorAll("path.chart-line").length, 1);
  const segsOf = (d) => d.split(/(?= C)/).slice(1).join("");
  assert.equal(lines.map((l) => segsOf(l.getAttribute("d"))).join(""), segsOf(full), "分けたことで、曲線の形が変わった");
});

test("チャート: 帯は、45 度の斜線のパターン(間隔6・線は ink・太さ1.5・濃さはトークン)と、その下の背景色のオーバーレイの 2 層。幅は、点の手前 0.44・次の点の先 0.19", () => {
  const el = chart({ todayIndex: 4, pendingIndex: 2 });
  const pat = el.querySelector("pattern");
  assert.ok(pat);
  assert.deepEqual([pat.getAttribute("width"), pat.getAttribute("height"), pat.getAttribute("patternUnits"), pat.getAttribute("patternTransform")], ["6", "6", "userSpaceOnUse", "rotate(45)"]);
  const ln = pat.querySelector("line");
  assert.deepEqual([ln.getAttribute("stroke"), ln.getAttribute("stroke-width")], ["var(--ink)", "1.5"]);
  assert.equal(ln.getAttribute("style"), "stroke-opacity:var(--pend-line-a)", "斜線の濃さが、トークンでない");
  const rect = el.querySelector(".chart-pending-band");
  const wash = el.querySelector(".chart-pending-wash");
  assert.ok(wash, "背景色のオーバーレイがない");
  assert.deepEqual([wash.getAttribute("fill"), wash.getAttribute("style")], ["var(--paper)", "fill-opacity:var(--pend-wash-a)"], "オーバーレイは、背景色(--paper)で、濃さはトークン");
  for (const a of ["x", "y", "width", "height"]) assert.equal(wash.getAttribute(a), rect.getAttribute(a), `オーバーレイと斜線の帯の ${a} が違う`);
  const order = [...el.querySelector("svg").children].map((c) => c.getAttribute("class") || c.tagName.toLowerCase());
  assert.ok(order.indexOf("chart-pending-wash") < order.indexOf("chart-pending-band"), "オーバーレイが、斜線の下(先に描く)でない");
  assert.ok(order.indexOf("path") < order.indexOf("chart-pending-wash"), "面の塗りが、オーバーレイの下でない(重ね順: 面 → オーバーレイ → 斜線 → 線 → 丸)");
  assert.ok(order.indexOf("chart-pending-band") < order.indexOf("chart-line"), "線が、斜線の上でない");
  assert.equal(rect.getAttribute("fill"), `url(#${pat.id})`, "帯が、パターンを使っていない");
  const px = padX + 2 * step, nx = padX + 3 * step;
  assert.ok(Math.abs(num(rect, "x") - (px - step * 0.44)) < 1e-6);
  assert.ok(Math.abs(num(rect, "x") + num(rect, "width") - (nx + step * 0.19)) < 1e-6);
  // デザインのイメージ(点の間隔 80 → 帯 405〜535 = 130)と同じ比率
  assert.ok(Math.abs((step * 0.44 + step + step * 0.19) / step - 1.63) < 1e-9);
  // チャートが複数あっても、パターンの id は重ならない
  const other = chart({ todayIndex: 4, pendingIndex: 1 });
  assert.notEqual(other.querySelector("pattern").id, pat.id);
});

test("チャート: 読み上げ用のラベル(role=img・aria-label・title)が付く。確定前が無いときは、何も増えない(今までと同じ)", () => {
  const el = chart({ todayIndex: 4, pendingIndex: 2 });
  const svg = el.querySelector("svg");
  assert.equal(svg.getAttribute("role"), "img");
  assert.match(svg.getAttribute("aria-label"), /確定前\(保存すると変わる可能性があります\)/);
  assert.match(svg.querySelector("title").textContent, /確定前/);
  for (const opts of [{ todayIndex: 4 }, { todayIndex: 4, pendingIndex: null }, {}]) {
    const p = chart(opts);
    assert.equal(p.querySelectorAll(".chart-pending-dot, .chart-pending-band, .chart-pending-line, pattern, title").length, 0);
    assert.equal(p.querySelector("svg").getAttribute("role"), null);
    assert.equal(p.querySelectorAll("path.chart-line").length, 1);
  }
});

test("チャート: 確定前の点が、先頭(月曜)でも・今日の 1 つ前でも描ける。次の点が無い・範囲外・点が 1 つのときは、無視する", () => {
  const first = chart({ todayIndex: 3, pendingIndex: 0 });
  assert.deepEqual([...first.querySelectorAll("path.chart-line")].map((l) => l.getAttribute("stroke-dasharray")), ["5 4", null], "先頭: 破線 + 実線");
  assert.ok(num(first.querySelector(".chart-pending-band"), "x") >= 0);
  const last = chart({ todayIndex: 3, pendingIndex: 2 });
  assert.deepEqual([...last.querySelectorAll("path.chart-line")].map((l) => l.getAttribute("stroke-dasharray")), [null, "5 4"], "今日の 1 つ前: 実線 + 破線");
  for (const bad of [3, 4, -1, 99, 1.5, "1", NaN]) {                              // 今日そのもの・未来・範囲外・整数でない
    const c = chart({ todayIndex: 3, pendingIndex: bad });
    assert.equal(c.querySelectorAll(".chart-pending-dot").length, 0, `pendingIndex=${bad} を無視していない`);
  }
  const one = chart({ todayIndex: 0, pendingIndex: 0 });                          // 月曜: 点が 1 つ
  assert.equal(one.querySelectorAll(".chart-pending-dot").length, 0);
  assert.equal(one.querySelectorAll("path.chart-line").length, 1);
});

// ───────── 各画面 ─────────
const NOWD = () => new Date(2026, 9, 27, 10, 0, 0);                 // 2026-10-27(火)。同じ週の月曜(10/26)が、確定前の日になる
const restoreClock = setClock(NOWD);
const store = await openStorage({ indexedDB: new IDBFactory() });
const real = new Api(store);
real.add_record("2026-10-10", "1h", "p", [1], [], "manual", 3, null);   // 過去の連続記録(10/10〜10/11。途切れている)
real.add_record("2026-10-11", "1h", "p", [1], [], "manual", 3, null);
real.add_record("2026-10-25", "1h", "x", [1], [], "manual", 4, null);
real.add_record("2026-10-26", "1h30", "y", [1, 2], [], "manual", 3, null);
real.add_record("2026-10-27", "45", "z", [1], [], "stopwatch", 3, "09:10");
real.add_exam("模試", "2026-11-10", 300);
const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });

const until = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };
async function show(name) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const view = await import(`../ui/js/views/${name}.js`);
  await view.render(root, api);
  return { root, view };
}
const pendEls = (root) => [...root.querySelectorAll(".pend")];
function startCrossing() {                                           // 10/26 23:05 に開始 → 10/27 になった
  stopwatch.reset();
  setClock(() => new Date(2026, 9, 26, 23, 5, 0));
  stopwatch.start();
  setClock(NOWD);
  refreshCrossing();
}
const endCrossing = () => { stopwatch.reset(); refreshCrossing(); };

test("またいでいないときは、どの画面にも、斜線がない(.pend も、確定前の印も、チャートの確定前の部品も)", async () => {
  endCrossing();
  for (const name of ["home", "stats", "cal", "shop"]) {
    const { root, view } = await show(name);
    assert.equal(pendEls(root).length, 0, `${name}: またいでいないのに、斜線がある`);
    assert.equal(root.querySelectorAll("[data-pending], .chart-pending-dot, .chart-pending-band, .sr-only").length, 0, `${name}: 確定前の印が残っている`);
    if (view.onLeave) view.onLeave();
  }
});

test("ホーム: 連続記録のカード・開始日の行(日付の行全体)・週間推移の点と線と帯に、斜線。今日・今月の目標・試験・タグ別・ポイント履歴・ポイント残高には、付けない", async () => {
  startCrossing();
  const { root, view } = await show("home");
  assert.ok(root.querySelector(".streak-box.pend"), "連続記録のカードに斜線がない");
  const rows = [...root.querySelectorAll(".lg-row")];
  const on = rows.filter((r) => r.classList.contains("pend"));
  assert.equal(on.length, 1, "斜線の行が 1 行だけでない");
  assert.match(on[0].querySelector(".d").textContent, /10\/26/);
  assert.equal(on[0].querySelectorAll(".pend").length, 0, "行の中の、棒や時間に、別に斜線がある(行全体の 1 つだけのはず)");
  assert.equal(on[0].dataset.pending, "true");
  assert.equal(rows.filter((r) => r.querySelector(".pend")).length, 0, "斜線の行の中に、さらに斜線がある");
  assert.equal(root.querySelectorAll(".chart-pending-dot").length, 1, "週間推移に、確定前の点がない");
  assert.equal(root.querySelectorAll(".chart-pending-line").length, 1);
  // 対象外
  for (const sel of [".home-meters", ".exam-card", ".split", ".top", ".note", ".lg-head"]) {
    assert.equal(root.querySelector(sel)?.querySelectorAll(".pend").length ?? 0, 0, `${sel} に、斜線がある(対象外)`);
  }
  // 週ログの行に、文字は足さない(「計測中」「+」「点線の枠」なし)。読み上げ用の文字だけ
  assert.doesNotMatch(on[0].textContent.replace(/確定前\(保存すると変わる可能性があります\)/g, ""), /計測中|\+|開始/);
  if (view.onLeave) view.onLeave();
});

test("統計(週): 開始日の行(日付の行全体)・連続記録の行に、斜線。ほかの日・概要・タグ・充実度には、付けない", async () => {
  startCrossing();
  const { root, view } = await show("stats");
  await until(() => root.querySelector(".st-daybar"), "月の日別(初期表示)");
  root.querySelector('#stPeriod .tbtn[data-p="week"]').click();
  await until(() => root.querySelector(".st-wk-row"), "今週のログ");
  const rows = [...root.querySelectorAll(".st-wk-row")];
  const on = rows.filter((r) => r.classList.contains("pend"));
  assert.equal(on.length, 1);
  assert.match(on[0].querySelector(".st-wk-d").textContent, /10\/26/);
  assert.equal(on[0].querySelectorAll(".pend").length, 0, "行の中の、棒や時間に、別に斜線がある(行全体の 1 つだけのはず)");
  assert.equal(on[0].dataset.pending, "true");
  assert.ok(root.querySelector(".st-streak.pend"), "連続記録の行に斜線がない");
  for (const id of ["#stOverview", "#stTags", "#stQuality", "#stWeekday"]) assert.equal(root.querySelector(id).querySelectorAll(".pend").length, 0, `${id} に、斜線がある(対象外)`);
  if (view.onLeave) view.onLeave();
});

test("統計(月): 開始日の日の棒・連続記録の行・進行中の連続記録の帯に、斜線。過去の連続記録の帯には、付けない", async () => {
  startCrossing();
  const { root, view } = await show("stats");
  await until(() => root.querySelector(".st-daybar"), "月の日別(初期表示)");
  const bars = [...root.querySelectorAll(".st-daybar")];
  const on = bars.filter((b) => b.classList.contains("pend"));
  assert.equal(on.length, 1, "斜線の日が 1 日だけでない");
  assert.equal(bars.indexOf(on[0]), 25, "10/26 の棒でない");
  assert.match(on[0].title, /10\/26/);
  assert.match(on[0].title, /確定前/);
  assert.ok(root.querySelector(".st-streak.pend"));
  const segs = [...root.querySelectorAll(".st-seg")];
  assert.ok(segs.length > 0);
  assert.ok(segs.some((x) => x.classList.contains("past")), "(前提)過去の連続記録の帯がない");
  assert.ok(segs.some((x) => !x.classList.contains("past")), "(前提)進行中の連続記録の帯がない");
  for (const s of segs) assert.equal(s.classList.contains("pend"), !s.classList.contains("past"), "進行中の帯だけに斜線");
  if (view.onLeave) view.onLeave();
});

test("カレンダー: 開始日のマス・連続記録の行に、斜線(マスの読み上げに「確定前」)。ほかのマスには、付けない", async () => {
  startCrossing();
  const { root, view } = await show("cal");
  await until(() => root.querySelector(".cal-cell"), "カレンダー");
  const on = [...root.querySelectorAll(".cal-cell.pend")];
  assert.equal(on.length, 1, "斜線のマスが 1 つだけでない");
  assert.equal(on[0].dataset.date, "2026-10-26");
  assert.match(on[0].getAttribute("aria-label"), /10月26日.*確定前\(保存すると変わる可能性があります\)/);
  assert.ok(root.querySelector("#calStreak.pend"), "連続記録の行に斜線がない");
  assert.match(root.querySelector("#calStreak").title, /確定前/);
  assert.equal(root.querySelector("#calStats").classList.contains("pend"), false, "月の合計(対象外)に、斜線がある");
  if (view.onLeave) view.onLeave();
});

test("カレンダー: 計測が終わったあと、月を移動して描き直すと、連続記録の行の斜線・title が消える(古い印が残らない)", async () => {
  startCrossing();
  const { root, view } = await show("cal");
  await until(() => root.querySelector(".cal-cell"), "カレンダー");
  assert.ok(root.querySelector("#calStreak.pend"));
  endCrossing();
  root.querySelector("#calPrev").click();
  await until(() => !root.querySelector("#calStreak").classList.contains("pend"), "連続記録の行の斜線が消える");
  const el = root.querySelector("#calStreak");
  assert.equal(el.hasAttribute("title"), false, "title が残っている");
  assert.equal(el.dataset.pending, undefined, "確定前の印が残っている");
  assert.equal(el.querySelector(".sr-only"), null, "読み上げ用の文字が残っている");
  assert.equal(root.querySelectorAll(".cal-cell.pend").length, 0);
  if (view.onLeave) view.onLeave();
});

test("ショップ: さぼり券の枚数に、斜線。ほかには、付けない", async () => {
  startCrossing();
  const { root, view } = await show("shop");
  const owned = root.querySelector(".sh-sabori .owned");
  assert.ok(owned?.classList.contains("pend"), "さぼり券の枚数に、斜線がない");
  assert.match(owned.textContent, /所持 \d+\/\d+枚/);
  assert.equal(pendEls(root).length, 1, "さぼり券の枚数のほかにも、斜線がある");
  if (view.onLeave) view.onLeave();
});

test("色・斜線だけに頼らない: 斜線の要素は、すべて、確定前の印(title / 読み上げ用の文字 / aria-label)を持つ。凡例の見本を除く", async () => {
  startCrossing();
  let total = 0;
  for (const name of ["home", "stats", "cal", "shop"]) {
    const { root, view } = await show(name);
    if (name === "stats") await until(() => root.querySelector(".st-daybar"), "統計");
    for (const el of pendEls(root)) {
      total++;
      const said = el.dataset.pending === "true" || el.querySelector(".sr-only") || /確定前/.test(el.getAttribute("aria-label") || el.getAttribute("title") || "");
      assert.ok(said, `${name}: ${el.className} に、確定前の印がない`);
      // 文字(数字)を含む要素は、title(ホバーだけ)に頼らず、読み上げ用の文字か aria-label を持つ
      const text = el.textContent.replace(/確定前\(保存すると変わる可能性があります\)/g, "").trim();
      if (text && !el.matches(".cal-cell")) assert.ok(el.querySelector(".sr-only"), `${name}: ${el.className}(${text.slice(0, 12)})に、読み上げ用の文字がない`);
      if (el.matches(".cal-cell[data-date]")) assert.match(el.getAttribute("aria-label"), /確定前/);
    }
    if (view.onLeave) view.onLeave();
  }
  assert.equal(total, 8, `斜線の要素の数が違う(ホーム 2・統計(月)3・カレンダー 2・ショップ 1): ${total}`);
});

test("計測が終わる(保存・リセット)と、次に描いた画面から、斜線が消える", async () => {
  startCrossing();
  assert.ok(pendEls((await show("home")).root).length > 0);
  endCrossing();
  for (const name of ["home", "cal", "shop"]) assert.equal(pendEls((await show(name)).root).length, 0, `${name}: 計測が終わったのに、斜線が残っている`);
});

// ───────── CSS ─────────
test("CSS: 斜線は、操作を妨げず(pointer-events:none)、数字・文字の上に重ねる(::after)。読み上げ用の文字は、画面に出ない。進行中の帯は、絶対配置のまま", () => {
  const comp = readFileSync(new URL("../ui/css/components.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const views = readFileSync(new URL("../ui/css/views.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(comp, /\.pend::after\{[^}]*pointer-events:none/);
  assert.match(comp, /\.sr-only\{position:absolute; width:1px; height:1px;/);
  assert.match(views, /\.st-seg\{position:absolute;/, "進行中の帯の絶対配置が、変わった(.pend の position:relative に負けている)");
});

test("斜線の濃さのトークン: ライト・ダーク(自動・手動)のすべてで定義されている。以前(.24 / .28)より濃く、斜線の下に背景色のオーバーレイがある", () => {
  const tokens = readFileSync(new URL("../ui/css/tokens.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const defs = [...tokens.matchAll(/--pend-line-a:\s*([\d.]+);\s*--pend-wash-a:\s*([\d.]+);/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(defs.length, 3, "ライト・ダーク(OS 設定に従う)・ダーク(手動)の 3 か所で、定義が必要");
  for (const [line, wash] of defs) {
    assert.ok(line > 0.28 && line <= 0.5, `斜線が、以前(.28)より濃く、濃すぎない範囲でない: ${line}`);
    assert.ok(wash >= 0.15 && wash <= 0.6, `背景色のオーバーレイが、見える・文字が読める範囲でない: ${wash}`);
  }
});

test("後始末", () => { endCrossing(); restoreClock(); });
