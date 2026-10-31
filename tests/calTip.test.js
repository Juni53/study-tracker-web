import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { setupDom } from "./_dom.js";

setupDom();
const T = await import("../ui/js/components/calTip.js");

test("動きの仕様: 移動200ms・イージング・旧い中身160msで消え、新しい中身260msで現れる", () => {
  assert.equal(T.MOVE_MS, 200);
  assert.equal(T.MOVE_EASE, "cubic-bezier(.3,.7,.2,1)");
  assert.equal(T.FADE_OUT_MS, 160);
  assert.equal(T.FADE_IN_MS, 260);
});

test("tipGeometry: 基本はセルの上。同じ行なら、高さが違っても下端の位置は同じ", () => {
  const cell = { left: 100, top: 300, width: 50, height: 50, bottom: 350 };
  const a = T.tipGeometry(cell, 200, 120, 800, 600);
  const b = T.tipGeometry(cell, 160, 80, 800, 600);
  assert.equal(a.above, true);
  assert.equal(a.top + 120, b.top + 80);          // 下端が同じ
  assert.equal(a.top + 120, cell.top - 6);
});
test("tipGeometry: 上に収まらないときは下 / 左右は画面端からはみ出さない", () => {
  const top = { left: 100, top: 20, width: 50, height: 50, bottom: 70 };
  const g = T.tipGeometry(top, 200, 120, 800, 600);
  assert.equal(g.above, false);
  assert.equal(g.top, 70 + 6);
  assert.equal(T.tipGeometry({ left: 0, top: 300, width: 50, bottom: 350 }, 200, 100, 800, 600).left, 14);
  assert.equal(T.tipGeometry({ left: 760, top: 300, width: 40, bottom: 350 }, 200, 100, 800, 600).left, 800 - 200 - 14); // 右端のセルでも、画面端から少し離す
});
test("tipGeometry: 縦に別の行へ移ると、下端も一緒に動く", () => {
  const r1 = { left: 100, top: 300, width: 50, bottom: 350 };
  const r2 = { left: 100, top: 400, width: 50, bottom: 450 };
  assert.notEqual(T.tipGeometry(r1, 200, 100, 800, 600).top, T.tipGeometry(r2, 200, 100, 800, 600).top);
});

const helpers = { tagById: (id) => ({ 1: { name: "数学" } }[id]), esc: (s) => String(s).replace(/</g, "&lt;"), fmtHM: (m) => `${m}m`, nowYear: 2026 };
test("buildTipParts: 記録も試験日も無い日(さぼり券だけ)は出さない", () => {
  assert.equal(T.buildTipParts(undefined, "2026-10-01", helpers), null);
  assert.equal(T.buildTipParts({ sabori: true, records: [], exams: [] }, "2026-10-01", helpers), null);
});
test("buildTipParts: 中身(body)と、日付・合計のフッター(footer)に分かれる", () => {
  const day = { minutes: 90, points: 12.5, exams: [{ name: "期末<1>" }], milestones: [{ streak: 7, points: 30 }],
    records: [{ minutes: 60, content: "微分", tag_ids: [] }, { minutes: 30, content: "", tag_ids: [1] }, { minutes: 5, content: "", tag_ids: [] }, { minutes: 5, content: "d" }] };
  const p = T.buildTipParts(day, "2026-10-26", helpers);
  assert.match(p.body, /試験日: 期末&lt;1>/);
  assert.match(p.body, /微分/);
  assert.match(p.body, /数学/);              // タイトルが無ければタグ名
  assert.ok(!/タイトルなし/.test(p.body));     // 先頭2件まで(コンパクトにするため)
  assert.match(p.body, /ほか 2件/);
  assert.match(p.body, /連続7日達成ボーナス \+30P/);
  assert.match(p.footer, /10月26日\(月\)/);
  assert.match(p.footer, /合計 90m ・ 4件 ・ \+12\.5P/);
  assert.ok(!/日(月)|合計/.test(p.body));    // 日付・合計はフッターだけ
});
test("buildTipParts: 試験日だけの日は、フッターに日付だけ / 今年でなければ年も出す", () => {
  const p = T.buildTipParts({ exams: [{ name: "模試" }], records: [] }, "2025-03-01", helpers);
  assert.match(p.footer, /2025年3月1日/);
  assert.ok(!/合計/.test(p.footer));
});

test("カードは1枚だけ: 別の日へ移ってもカードを作り直さず、中身も1つに入れ替わる(動かせない環境では即座に)", () => {
  const mkCell = (iso, rect) => { const c = document.createElement("div"); c.dataset.date = iso; c.getBoundingClientRect = () => rect; document.body.append(c); return c; };
  const c1 = mkCell("2026-10-01", { left: 100, top: 300, width: 50, bottom: 350 });
  const c2 = mkCell("2026-10-02", { left: 160, top: 300, width: 50, bottom: 350 });
  const tip = T.createCalTip({ partsOf: (iso) => T.buildTipParts({ minutes: 10, points: 1, records: [{ minutes: 10, content: iso }] }, iso, helpers) });
  assert.equal(document.querySelectorAll(".cal-tip").length, 1);
  tip.show(c1);
  assert.equal(tip.visible, true);
  const first = tip.el.style.left;
  tip.show(c2);
  assert.equal(document.querySelectorAll(".cal-tip").length, 1);
  assert.equal(tip.layerCount, 1);
  assert.match(tip.el.textContent, /2026-10-02/);
  assert.notEqual(tip.el.style.left, first);          // 次の日の位置へ
  tip.hide();
  assert.equal(tip.visible, false);
  assert.equal(tip.layerCount, 0);
  tip.destroy();
  assert.equal(document.querySelectorAll(".cal-tip").length, 0);
});

test("CSS: 中身は下端に揃え、カードは枠の中を隠す", () => {
  const css = fs.readFileSync(new URL("../ui/css/views.css", import.meta.url), "utf8");
  assert.match(css, /\.cal-tip-layer\{[^}]*bottom:0/);
  assert.match(css, /\.cal-tip\{[^}]*overflow:hidden/);
});
