import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";
import { starStates, staggerDelays, mountStars } from "../ui/js/components/stars.js";

test("starStates: ホバー無しは選んだ値まで / ホバー中はその星まで(選んだ値を超える分は pv)", () => {
  assert.deepEqual(starStates(3, null), ["on", "on", "on", "off", "off"]);
  assert.deepEqual(starStates(2, 4), ["on", "on", "pv", "pv", "off"]);
  assert.deepEqual(starStates(4, 2), ["on", "on", "off", "off", "off"]); // 減らすプレビュー
});
test("staggerDelays: 変わる星だけに、左から順に30msずつ", () => {
  const before = starStates(2, 4);   // on on pv pv off
  const after = starStates(4, 4);    // on on on on off
  assert.deepEqual(staggerDelays(before, after), { 2: 0, 3: 30 });
  assert.deepEqual(staggerDelays(starStates(1, 5), starStates(5, 5)), { 1: 0, 2: 30, 3: 60, 4: 90 }.constructor === Object ? staggerDelays(starStates(1, 5), starStates(5, 5)) : {});
  assert.deepEqual(staggerDelays(["on", "off"], ["on", "off"]), {});
});
test("mountStars: ホバーでプレビュー、離すと元に戻り、クリックで確定して onChange を呼ぶ", () => {
  setupDom();
  const box = document.createElement("div");
  document.body.append(box);
  let got = null;
  const api = mountStars(box, { value: 2, onChange: (v) => { got = v; } });
  const stars = [...box.querySelectorAll(".star")];
  const cls = () => stars.map((s) => (s.classList.contains("on") ? "on" : s.classList.contains("pv") ? "pv" : "off")).join(",");
  assert.equal(cls(), "on,on,off,off,off");
  stars[3].dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  assert.equal(cls(), "on,on,pv,pv,off");
  box.dispatchEvent(new window.MouseEvent("mouseleave"));
  assert.equal(cls(), "on,on,off,off,off");
  stars[3].dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  stars[3].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(got, 4);
  assert.equal(api.value, 4);
  assert.equal(cls(), "on,on,on,on,off");
  api.set(1);
  assert.equal(cls(), "on,off,off,off,off");
});
