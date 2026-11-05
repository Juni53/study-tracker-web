// 見出しの日付(components/todayDate.js): 形式・時計との連動・文字だけの入れ替え。全タブの見出しにあることは、dayrollover.app.test.js が確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom } from "./_dom.js";
import { setClock } from "../ui/js/core/dates.js";

setupDom("<!DOCTYPE html><body></body>");
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });   // 動きを減らす設定 = すぐに書き換える
const { dateLabel, todayDateHtml, updateTodayDates } = await import("../ui/js/components/todayDate.js");

test("dateLabel: 「2026-11-13 (金)」の形。曜日は、月〜日の7日とも正しい", () => {
  assert.equal(dateLabel("2026-11-13"), "2026-11-13 (金)");
  const week = ["月", "火", "水", "木", "金", "土", "日"];
  week.forEach((w, i) => assert.equal(dateLabel(`2026-11-${String(9 + i).padStart(2, "0")}`), `2026-11-${String(9 + i).padStart(2, "0")} (${w})`));
  assert.equal(dateLabel("2024-02-29"), "2024-02-29 (木)");        // うるう日
  assert.equal(dateLabel("2026-01-01"), "2026-01-01 (木)");        // 年の初め(0 埋め)
  assert.throws(() => dateLabel("2026-02-30"));                    // 存在しない日付は、黙って別の日にしない
});

test("todayDateHtml: 共通の時計の「今日」を使う(new Date() を直接使わない)。部品の印(data-today-date)と、クロスフェード用の包みがある", () => {
  const restore = setClock(() => new Date(2026, 10, 13, 23, 59, 59));
  try {
    const box = document.createElement("div");
    box.innerHTML = todayDateHtml();
    const el = box.querySelector("[data-today-date]");
    assert.ok(el);
    assert.equal(el.textContent, "2026-11-13 (金)");
    assert.ok(el.classList.contains("mono") && el.classList.contains("xf-host"));
    assert.equal(el.querySelectorAll(".xf").length, 1);
  } finally { restore(); }
  // 引数なしの dateLabel() も、共通の時計から(UTC 基準の toISOString ではなく、現地の日付で。日本の朝 8 時は、UTC ではまだ前日)
  const restore2 = setClock(() => new Date(2026, 10, 13, 8, 0, 0));
  try { assert.equal(dateLabel(), "2026-11-13 (金)"); } finally { restore2(); }
});

test("updateTodayDates: 画面にある日付の要素すべてを入れ替える。同じ日付なら、要素に触れない", () => {
  document.body.innerHTML = `<div id="a">${todayDateHtml("2026-11-12")}</div><div id="b">${todayDateHtml("2026-11-12")}</div>`;
  const spans = [...document.querySelectorAll(".xf")];
  updateTodayDates("2026-11-12");
  assert.deepEqual([...document.querySelectorAll(".xf")], spans, "同じ日付なのに、要素を作り直した");
  updateTodayDates("2026-11-13");
  assert.deepEqual([...document.querySelectorAll("[data-today-date]")].map((e) => e.textContent), ["2026-11-13 (金)", "2026-11-13 (金)"]);
  updateTodayDates("2026-11-14", { animate: false });
  assert.deepEqual([...document.querySelectorAll("[data-today-date]")].map((e) => e.textContent), ["2026-11-14 (土)", "2026-11-14 (土)"]);
  // 入れ替え中の途中の状態でも、「いまの文字」は1つだけ
  assert.equal(document.querySelectorAll("#a .xf:not(.xf-out)").length, 1);
});

test("フィードバックのタブ(URL の有無にかかわらず)の見出しにも、日付がある", async () => {
  const restore = setClock(() => new Date(2026, 10, 13, 9, 0, 0));
  try {
    const { render } = await import("../ui/js/views/feedback.js");
    for (const link of [null, { href: "https://example.com/f", withVersion: false, version: "v3.0.0" }]) {
      const root = document.createElement("div");
      await render(root, {}, { link });
      assert.equal(root.querySelector(".top .right [data-today-date]")?.textContent, "2026-11-13 (金)");
    }
  } finally { restore(); }
});

test("見出し行は、狭い画面で入りきらないときに、右側(日付・ポイント)が次の行へ回る", () => {
  const css = readFileSync(new URL("../ui/css/shell.css", import.meta.url), "utf8");
  assert.match(css, /\.top\{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.top \.right\{[^}]*margin-left:auto/);
});
