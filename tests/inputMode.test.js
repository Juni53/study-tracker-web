import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { initInputMode, isTouchInput, TOUCH_CLASS } = await import("../ui/js/components/inputMode.js");
initInputMode();

function fire(target, type, { pointerType, x = 0, y = 0 } = {}) {
  const e = new window.Event(type, { bubbles: true });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  Object.defineProperty(e, "clientX", { value: x });
  Object.defineProperty(e, "clientY", { value: y });
  target.dispatchEvent(e);
}
const html = () => document.documentElement;

test("最初はタッチ中ではない(ホバーの見た目が出る)", () => {
  assert.equal(isTouchInput(), false);
  assert.equal(html().classList.contains(TOUCH_CLASS), false);
});

test("タッチで押すと is-touch が付き、マウスで押すと外れる", () => {
  fire(document.body, "pointerdown", { pointerType: "touch" });
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointerdown", { pointerType: "mouse", x: 5, y: 5 });
  assert.equal(isTouchInput(), false);
});

test("マウスを実際に動かすと外れる。タッチ後にブラウザが合成する『同じ位置のマウス移動』では外れない", () => {
  fire(document.body, "pointermove", { pointerType: "mouse", x: 100, y: 100 });
  fire(document.body, "pointerdown", { pointerType: "touch", x: 300, y: 300 });
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointermove", { pointerType: "mouse", x: 100, y: 100 });        // 合成された移動(位置が同じ)
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointermove", { pointerType: "mouse", x: 101, y: 100 });        // 1px だけのぶれ
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointermove", { pointerType: "mouse", x: 160, y: 120 });        // 本当にマウスを動かした
  assert.equal(isTouchInput(), false);
});

test("タッチの移動(指でなぞる)では外れない / ペンは、どちらの状態も変えない", () => {
  fire(document.body, "pointerdown", { pointerType: "touch" });
  fire(document.body, "pointermove", { pointerType: "touch", x: 500, y: 500 });
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointerdown", { pointerType: "pen" });
  assert.equal(isTouchInput(), true);
  fire(document.body, "pointerdown", { pointerType: "mouse", x: 1, y: 1 });
  fire(document.body, "pointerdown", { pointerType: "pen" });
  assert.equal(isTouchInput(), false);
});

test("画面の部品が stopPropagation しても、(キャプチャ段階で見ているので)判定できる", () => {
  const child = document.createElement("button");
  child.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(child);
  fire(child, "pointerdown", { pointerType: "touch" });
  assert.equal(isTouchInput(), true);
  child.remove();
});
