// Study Tracker v3 - フォームのエラー表示(追加・編集のポップアップ共通)
//
// 保存ボタンの上に、朱色の文を出す。該当の入力欄の下線(ボックス型は枠)も朱色にして、そこへフォーカスする。
// 入力を始めると、文がフェードして消え、入力欄の色も戻る。
// 出る/消えるときは文の高さが滑らかに広がる/縮む(ポップアップの高さもそれに合わせて動く)。
//
// HTML 側は、保存ボタン(.modal-actions)の上に空の要素を置くだけ:  <div class="form-err" id="xxxErr" hidden></div>
//
//   const err = createFormError(popup.querySelector("#xxxErr"));
//   err.show("試験名を入力してください", { fields: [nameInput] });     // fields: 朱色にする入力欄(先頭へフォーカス)
//   err.watch([nameInput]);                                          // これらに入力されたら消す(1度だけ呼べばよい)
//   err.reset();                                                     // ポップアップを開き直すとき。動かさずに消す

import { revealY } from "./motion.js";

export function createFormError(el) {
  let textEl = el.querySelector(".form-err-text");
  if (!textEl) {
    textEl = document.createElement("div");
    textEl.className = "form-err-text";
    el.append(textEl);
  }
  el.setAttribute("role", "alert");
  let marked = [];

  const unmark = () => { marked.forEach((f) => f.classList.remove("err")); marked = []; };

  function show(message, { fields = [], focus = null } = {}) {
    unmark();
    fields.forEach((f) => f.classList.add("err"));
    marked = fields.slice();
    textEl.textContent = message;
    revealY(el, true);
    const target = focus || fields[0];
    if (target && typeof target.focus === "function") target.focus();
  }

  // 消す。immediate なら、動かさずにすぐ消す(ポップアップを開き直すときなど)
  function clear({ immediate = false } = {}) {
    unmark();
    if (immediate) {
      if (el._reveal) { el._reveal.anim.cancel(); el._reveal = null; }
      el.hidden = true;
      textEl.textContent = "";
      return;
    }
    revealY(el, false);
  }

  // 入力されたら(input イベント)消す。表示していないときは何もしない
  function watch(inputs) {
    inputs.forEach((inp) => inp.addEventListener("input", () => { if (!el.hidden) clear(); }));
  }

  return { show, clear, reset: () => clear({ immediate: true }), watch, get visible() { return !el.hidden; }, el };
}
