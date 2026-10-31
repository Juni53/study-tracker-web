import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { bindRadioGroup } = await import("../ui/js/components/radioGroup.js");

function build() {
  document.body.innerHTML = `
    <div id="a"><button class="tbtn active" data-v="a1"><span>A1</span></button><button class="tbtn" data-v="a2">A2</button><button class="tbtn" data-v="a3">A3</button></div>
    <div id="b"><button class="tbtn active" data-v="b1">B1</button><button class="tbtn" data-v="b2">B2</button></div>`;
  const a = document.getElementById("a"), b = document.getElementById("b");
  const calls = [];
  const ga = bindRadioGroup(a, (btn) => calls.push(["a", btn.dataset.v]));
  const gb = bindRadioGroup(b, (btn) => calls.push(["b", btn.dataset.v]));
  const act = (el) => [...el.querySelectorAll(".tbtn.active")].map((x) => x.dataset.v);
  return { a, b, ga, gb, calls, act };
}

test("押した列の中だけで選択が切り替わり、別の列の選択・処理には、まったく影響しない", () => {
  const { a, b, calls, act } = build();
  a.querySelector('[data-v="a2"]').click();
  assert.deepEqual(act(a), ["a2"]);
  assert.deepEqual(act(b), ["b1"]);                         // もう片方の列は、そのまま
  b.querySelector('[data-v="b2"]').click();
  assert.deepEqual(act(a), ["a2"]);
  assert.deepEqual(act(b), ["b2"]);
  assert.deepEqual(calls, [["a", "a2"], ["b", "b2"]]);       // 処理も、押した列のものだけが1回ずつ
});

test("選ばれているボタンを押しても、何も起きない(処理を呼ばない)", () => {
  const { a, calls, act } = build();
  a.querySelector('[data-v="a1"]').click();
  assert.deepEqual(calls, []);
  assert.deepEqual(act(a), ["a1"]);
});

test("ボタンの中の要素を押しても、ボタンを押したことになる / ボタン以外の場所は無視", () => {
  const { a, calls } = build();
  a.querySelector('[data-v="a1"] span').click();             // 選ばれているボタンの中身
  assert.deepEqual(calls, []);
  a.click();                                                  // 入れ物そのもの
  assert.deepEqual(calls, []);
  a.querySelector('[data-v="a3"]').click();
  assert.deepEqual(calls, [["a", "a3"]]);
});

test("setActive: 判定関数に合うボタンだけを選択状態にする(その列だけ)", () => {
  const { a, b, ga, act } = build();
  ga.setActive((btn) => btn.dataset.v === "a3");
  assert.deepEqual(act(a), ["a3"]);
  assert.deepEqual(act(b), ["b1"]);
});
