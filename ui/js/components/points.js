// Study Tracker v3 - ポイント残高の表示(全タブ共通)
// 各タブのヘッダー右上のポイント表示を一元管理する。
//  - タブを開いたときは mountPoints() で、いまの残高をそのまま表示する(カウントはしない)。
//  - 記録の保存・削除・購入などでポイントが変わったら refreshPoints() / setBalance() を呼ぶ。
//    表示中の全ての要素が、数字を数え上げ(または数え下げ)ながら新しい残高に変わり、あわせて次の演出が入る:
//      増加: 下から上へ / 減少: 上から下へ、不透明な「文字色の塗りつぶし」が横切り、
//            塗りつぶされた部分は文字色が背景色に反転する。↗ / ↘ の矢印がフェードアウトして増減を示す。
//  - 残高は常にここで最新に保つので、別のタブへ移っても、戻っても、表示が古いままにならない。
//
// 表示要素の中身: [数字のテキスト][.pts-inv(反転した文字を載せた塗りつぶし層)][.pts-arrow(矢印)]
//   .pts-inv / .pts-arrow は中身が空で、文字は CSS の ::after が data 属性から出す。
//   → el.textContent は数字のテキストだけになる(読み上げや、テキストを読む処理に余計な文字が混ざらない)。

import { EASE_OUT, reduceMotion } from "./motion.js";

const DURATION_MIN = 450;   // ms。変化が小さいときの数え上げの長さ
const DURATION_MAX = 1000;  // ms。変化が大きいときの数え上げの長さ
const SWEEP_MIN = 650;      // ms。塗りつぶしが横切る時間の下限
const ARROW_MS = 1400;      // ms。矢印がフェードアウトする時間

let balance = null;         // 最後に確定した残高(数値)。まだ一度も表示していなければ null
let shown = null;           // いま画面に出ている数値(アニメーション中は途中の値)
let raf = null;             // 実行中の数え上げ
const els = new Set();      // 表示中の要素
const handles = new WeakMap(); // 要素 → { text, inv, arrow, effects }

// 残高の小数の桁数(0〜2)。数え上げ中も最終表示と同じ桁数でそろえ、最後に桁が増減してがたつかないようにする。
function decimalsOf(n) {
  const s = String(Math.round(n * 100) / 100);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}
function format(n, decimals) {
  return `${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} P`;
}

function prepare(el) {
  let h = handles.get(el);
  if (h) return h;
  const text = document.createTextNode("");
  const inv = document.createElement("span");
  inv.className = "pts-inv";
  inv.setAttribute("aria-hidden", "true");
  const arrow = document.createElement("span");
  arrow.className = "pts-arrow";
  arrow.setAttribute("aria-hidden", "true");
  el.textContent = "";
  el.append(text, inv, arrow);
  el.classList.add("pts-live");
  h = { text, inv, arrow, effects: [] };
  handles.set(el, h);
  return h;
}

function setText(el, text) {
  const h = prepare(el);
  h.text.nodeValue = text;
  h.inv.dataset.text = text; // 反転層に載せる文字(CSS の ::after が表示)
}

function paint(n, decimals) {
  const text = format(n, decimals);
  for (const el of [...els]) {
    if (!el.isConnected) { els.delete(el); continue; } // 離れたタブの要素は忘れる
    setText(el, text);
  }
}

// 増減の演出。dir: +1 増加 / -1 減少
//  塗りつぶし層(.pts-inv)は clip-path で見える範囲を動かす:
//    増加: 下の縁から現れて上へ広がり(全体が反転)、そのまま上の縁へ抜けていく
//    減少: 上の縁から現れて下へ広がり、そのまま下の縁へ抜けていく
//  どちらも、終わったあとは何も残さない(元の「見えない」状態に戻る)。
function playEffect(dir, duration) {
  if (reduceMotion()) return;
  const frames = dir > 0
    ? [{ clipPath: "inset(100% 0 0 0)" }, { clipPath: "inset(0 0 0 0)", offset: 0.5 }, { clipPath: "inset(0 0 100% 0)" }]
    : [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)", offset: 0.5 }, { clipPath: "inset(100% 0 0 0)" }];
  for (const el of els) {
    const h = handles.get(el);
    if (!h || !el.isConnected || typeof h.inv.animate !== "function") continue;
    h.effects.forEach((a) => a.cancel());
    h.arrow.dataset.arrow = dir > 0 ? "↗" : "↘";
    h.effects = [
      h.inv.animate(frames, { duration: Math.max(SWEEP_MIN, duration), easing: "cubic-bezier(.45, 0, .25, 1)" }),
      // 矢印: はじめは見えていて、少し間をおいてからフェードアウト
      h.arrow.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: ARROW_MS, easing: EASE_OUT }),
    ];
  }
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

function stopAnimation() {
  if (raf != null) { cancelAnimationFrame(raf); raf = null; }
}

// 新しい残高へ、いま見えている値から数えて変える
export function setBalance(value) {
  value = Number(value);
  if (!Number.isFinite(value)) return;
  const target = Math.round(value * 100) / 100;
  stopAnimation();
  const from = shown == null ? target : shown;
  balance = target;
  const decimals = decimalsOf(target);

  if (from === target) {
    shown = target;
    paint(target, decimals);
    return;
  }
  const dir = target > from ? 1 : -1;
  const diff = Math.abs(target - from);
  const duration = Math.min(DURATION_MAX, DURATION_MIN + diff * 2); // 大きく変わるほど少し長く
  playEffect(dir, duration);

  if (reduceMotion() || typeof requestAnimationFrame !== "function") {
    shown = target;
    paint(target, decimals);
    return;
  }
  const t0 = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - t0) / duration);
    if (t >= 1) {
      raf = null;
      shown = target;
      paint(target, decimals);
      return;
    }
    shown = from + (target - from) * easeOutCubic(t);
    paint(shown, decimals);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

// タブの描画時に、ヘッダーのポイント要素を登録して、いまの残高を表示する。
// value はそのタブが取得した最新の残高。すでに把握している残高と違っていれば(別の操作で変わっていた場合など)、
// 把握していた値から数えて変える。同じなら、そのまま表示する(進行中のアニメーションも止めない)。
export function mountPoints(el, value) {
  value = Number(value);
  if (!el || !Number.isFinite(value)) return;
  els.add(el);
  const target = Math.round(value * 100) / 100;
  if (balance == null) {          // 最初の表示: そのまま出す
    balance = shown = target;
    paint(target, decimalsOf(target));
    return;
  }
  // いま見えている値を、この要素にも出してから、必要なら数え始める
  setText(el, format(shown, decimalsOf(balance)));
  if (target !== balance) setBalance(target);
}

// サーバー(Python)側の最新の残高を取り直して、数えながら反映する
export async function refreshPoints(api) {
  try {
    const v = await api.get_points_balance();
    if (v != null) setBalance(v);
  } catch (e) {
    console.error("ポイント残高の取得に失敗しました", e);
  }
}
