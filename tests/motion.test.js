import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { revealX, revealY } = await import("../ui/js/components/motion.js");
const { morphText, initMorph, textOf } = await import("../ui/js/components/morph.js");

// jsdom には Element.animate が無いので、「動かさずにすぐ切り替える」経路を確かめる(動きそのものは実機で確認する)
test("revealX / revealY: 動かせない環境では、hidden をすぐ切り替える", () => {
  const el = document.createElement("button");
  document.body.append(el);
  revealX(el, false); assert.equal(el.hidden, true);
  revealX(el, true); assert.equal(el.hidden, false);
  revealY(el, false); assert.equal(el.hidden, true);
  revealY(el, true); assert.equal(el.hidden, false);
});
test("morphText: 文字が書き換わる(古い .xf は残らない)", () => {
  const host = document.createElement("button");
  document.body.append(host);
  initMorph(host, "開始");
  morphText(host, "一時停止");
  assert.equal(textOf(host), "一時停止");
  assert.equal(host.querySelectorAll(".xf").length, 1);
  morphText(host, "一時停止");                      // 同じ文字なら何もしない
  assert.equal(host.querySelectorAll(".xf").length, 1);
  morphText(host, "再開", { animate: false });
  assert.equal(textOf(host), "再開");
});
test("morphText: .xf が無い要素は、最初の呼び出しで作る", () => {
  const host = document.createElement("div");
  morphText(host, "停止中");
  assert.equal(host.querySelector(".xf").textContent, "停止中");
});
