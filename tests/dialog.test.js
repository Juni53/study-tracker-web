import test from "node:test";
import assert from "node:assert/strict";
import { setupDom, key, tick } from "./_dom.js";

setupDom();
const { showConfirm, showAlert } = await import("../ui/js/components/dialog.js");
// 閉じたダイアログは、アニメーションのあいだ DOM に残る。いま開いているもの(.open)のうち、最後のものを見る
const overlay = () => [...document.querySelectorAll(".modal-overlay.dlg.open")].pop();
const focusedKind = () => document.activeElement && document.activeElement.dataset.dlg;

test("通常の確認: 最初のフォーカスは OK、Enter で OK(true)", async () => {
  const p = showConfirm("進みますか？");
  assert.equal(focusedKind(), "ok");
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, true);
});
test("danger: 最初のフォーカスはキャンセル、Enter はキャンセル(false)", async () => {
  const p = showConfirm("削除しますか？", { danger: true, okText: "削除する" });
  assert.equal(focusedKind(), "cancel");
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, false);
});
test("danger: Tab で OK へ移って Enter なら実行(true)。Tab を押すと .kbd が付く(それまでは付かない)", async () => {
  const p = showConfirm("削除しますか？", { danger: true });
  assert.equal(overlay().classList.contains("kbd"), false);
  document.dispatchEvent(key("Tab"));
  assert.equal(focusedKind(), "ok");
  assert.equal(overlay().classList.contains("kbd"), true);
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, true);
});
test("danger: OK をクリックすれば実行(true)", async () => {
  const p = showConfirm("削除しますか？", { danger: true });
  overlay().querySelector('[data-dlg="ok"]').click();
  assert.equal(await p, true);
});
test("Esc はいつでもキャンセル(通常でも danger でも)", async () => {
  let p = showConfirm("進みますか？");
  document.dispatchEvent(key("Escape"));
  assert.equal(await p, false);
  p = showConfirm("削除しますか？", { danger: true });
  document.dispatchEvent(key("Tab")); // OK にフォーカスがあっても
  document.dispatchEvent(key("Escape"));
  assert.equal(await p, false);
});
test("Tab はダイアログの中を巡る(Shift+Tab で逆向き)", async () => {
  const p = showConfirm("確認", {});
  assert.equal(focusedKind(), "ok");
  document.dispatchEvent(key("Tab"));          // 末尾 → 先頭
  assert.equal(focusedKind(), "cancel");
  document.dispatchEvent(key("Tab", { shiftKey: true })); // 先頭 → 末尾
  assert.equal(focusedKind(), "ok");
  document.dispatchEvent(key("Escape"));
  await p;
});
test("Enter の押しっぱなし(キーリピート)は無視する", async () => {
  const p = showConfirm("確認");
  let settled = false;
  p.then(() => { settled = true; });
  document.dispatchEvent(key("Enter", { repeat: true }));
  await tick(5);
  assert.equal(settled, false);
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, true);
});
test("alert は OK だけ。Enter で閉じる", async () => {
  const p = showAlert("お知らせ");
  assert.equal(overlay().querySelector('[data-dlg="cancel"]'), null);
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, undefined);
});
test("閉じると、開く前にフォーカスのあった要素へ戻る / メッセージは文字として表示する", async () => {
  const btn = document.createElement("button");
  document.body.append(btn);
  btn.focus();
  const p = showConfirm("<b>太字</b>", { danger: true });
  assert.equal(overlay().querySelector(".dlg-message").innerHTML, "&lt;b&gt;太字&lt;/b&gt;");
  document.dispatchEvent(key("Escape"));
  await p;
  assert.equal(document.activeElement, btn);
});

// ── showChoice(3つの選択肢) ──
const { showChoice } = await import("../ui/js/components/dialog.js");
test("showChoice: ボタンを押すと、右端=ok・真ん中=alt・キャンセル=null", async () => {
  for (const [kind, expected] of [["ok", "ok"], ["alt", "alt"], ["cancel", null]]) {
    const p = showChoice("どうしますか？", { okText: "上書き", altText: "統合" });
    overlay().querySelector(`[data-dlg="${kind}"]`).click();
    assert.equal(await p, expected, kind);
  }
});
test("showChoice(danger): 最初のフォーカスはキャンセル・Tab の順は キャンセル→alt→ok・Enter は押したボタンの結果", async () => {
  const p = showChoice("どうしますか？", { okText: "上書き", altText: "統合", danger: true });
  assert.equal(focusedKind(), "cancel");
  document.dispatchEvent(key("Tab"));
  assert.equal(focusedKind(), "alt");
  document.dispatchEvent(key("Tab"));
  assert.equal(focusedKind(), "ok");
  document.dispatchEvent(key("Tab"));
  assert.equal(focusedKind(), "cancel");
  document.dispatchEvent(key("Tab"));
  assert.equal(focusedKind(), "alt");
  document.dispatchEvent(key("Enter"));
  assert.equal(await p, "alt");
});
test("showChoice: Esc はキャンセル(null)・showConfirm の結果は従来どおり true/false", async () => {
  let p = showChoice("どうしますか？", { altText: "統合" });
  document.dispatchEvent(key("Escape"));
  assert.equal(await p, null);
  const c = showConfirm("進みますか？");
  overlay().querySelector('[data-dlg="alt"]') === null && overlay().querySelector('[data-dlg="ok"]').click();
  assert.equal(await c, true);
});
