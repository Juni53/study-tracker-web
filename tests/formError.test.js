import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";
import { createFormError } from "../ui/js/components/formError.js";

function mk() {
  setupDom();
  document.body.innerHTML = `<input id="a" class="finput"><input id="b" class="finput"><div class="form-err" hidden></div>`;
  const a = document.getElementById("a"), b = document.getElementById("b");
  const err = createFormError(document.querySelector(".form-err"));
  return { a, b, err, el: document.querySelector(".form-err") };
}

test("show: 文を出し、該当の入力欄を朱色(.err)にして、先頭へフォーカスする", () => {
  const { a, b, err, el } = mk();
  err.show("試験名を入力してください", { fields: [a, b] });
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, "試験名を入力してください");
  assert.ok(a.classList.contains("err") && b.classList.contains("err"));
  assert.equal(document.activeElement, a);
  assert.equal(el.getAttribute("role"), "alert");
});
test("focus を指定すると、そちらへフォーカスする(日付の3欄を朱色にして、問題のある欄へ)", () => {
  const { a, b, err } = mk();
  err.show("月は1〜12", { fields: [a, b], focus: b });
  assert.equal(document.activeElement, b);
});
test("watch: 入力が始まると消え、入力欄の色も戻る / 表示していないときは何も起きない", () => {
  const { a, err, el } = mk();
  err.watch([a]);
  a.dispatchEvent(new window.Event("input"));       // 表示前: 何も起きない
  assert.equal(el.hidden, true);
  err.show("エラー", { fields: [a] });
  a.dispatchEvent(new window.Event("input"));
  assert.equal(el.hidden, true);
  assert.equal(a.classList.contains("err"), false);
});
test("新しいエラーに差し替えると、前の入力欄の朱色は外れる", () => {
  const { a, b, err } = mk();
  err.show("1", { fields: [a] });
  err.show("2", { fields: [b] });
  assert.equal(a.classList.contains("err"), false);
  assert.ok(b.classList.contains("err"));
});
test("reset: 動かさずにすぐ消す(ポップアップを開き直すとき)", () => {
  const { a, err, el } = mk();
  err.show("エラー", { fields: [a] });
  err.reset();
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, "");
  assert.equal(a.classList.contains("err"), false);
});
