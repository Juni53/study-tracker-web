// Study Tracker v3 - ラベルのクロスフェード(ボタンの文字・状態の文・サイドバーのタイマー表示)
//
// 使い方: 文字を入れる要素(.xf-host)の中に、いまの文字を持つ <span class="xf"> を1つ置く。
//   <button class="btn xf-host"><span class="xf">開始</span></button>
//   morphText(button, "一時停止");   // 古い文字がフェードアウト、新しい文字がフェードイン、ボタンの幅が滑らかに伸縮する
//
//  - 毎秒の更新のような「同じ種類の中での書き換え」には、{ animate: false } で、文字だけを書き換える(アニメーションなし)。
//  - 途中でもう一度呼ばれたら、そこまでの幅から、新しい文字へ向かって動かし直す。
//  - 「動きを減らす」設定のとき・要素が見えていないとき・Web Animations が使えないときは、すぐに書き換える。

import { EASE_OUT, EASE_IN, EASE_INOUT, reduceMotion } from "./motion.js";

const currentSpan = (host) => host.querySelector(":scope > .xf:not(.xf-out)");

// 進行中のクロスフェードがあれば、その場で終わらせる(古い文字を取り除き、幅の動きを止める)
function settle(host) {
  const m = host._morph;
  if (!m) return;
  host._morph = null;
  m.anims.forEach((a) => a.cancel());
  m.old.remove();
}

export function morphText(host, text, { animate = true, width = true, duration = 240 } = {}) {
  let cur = currentSpan(host);
  if (!cur) {                       // はじめて(まだ .xf が無い)
    host.textContent = "";
    cur = document.createElement("span");
    cur.className = "xf";
    cur.textContent = text;
    host.append(cur);
    return;
  }
  if (cur.textContent === text) return;

  const canMove = animate && !reduceMotion() && typeof host.animate === "function" && host.isConnected && host.getClientRects().length > 0;
  const startW = canMove && width ? host.getBoundingClientRect().width : 0; // 途中なら、いまの幅から続ける
  settle(host);
  cur = currentSpan(host);
  if (!canMove) { cur.textContent = text; return; }

  const oldW = width ? (startW || host.getBoundingClientRect().width) : 0;
  cur.classList.add("xf-out");      // 古い文字は重ねて(場所をとらない)フェードアウトさせる
  const next = document.createElement("span");
  next.className = "xf";
  next.textContent = text;
  host.append(next);
  const newW = width ? host.getBoundingClientRect().width : 0;

  const anims = [
    cur.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration * 0.8, easing: EASE_IN, fill: "forwards" }),
    next.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: EASE_OUT, fill: "backwards" }),
  ];
  if (width && Math.abs(oldW - newW) > 0.5) {
    anims.push(host.animate([{ width: `${oldW}px` }, { width: `${newW}px` }], { duration, easing: EASE_INOUT }));
  }
  const state = { old: cur, anims };
  host._morph = state;
  Promise.all(anims.map((a) => a.finished)).then(() => { if (host._morph === state) settle(host); }).catch(() => {});
}

// 初期状態を、アニメーションなしで作る(ボタン・ラベルの中身を .xf で包む)
export function initMorph(host, text) {
  host.classList.add("xf-host");
  host.textContent = "";
  const span = document.createElement("span");
  span.className = "xf";
  span.textContent = text;
  host.append(span);
}

export const textOf = (host) => (currentSpan(host) || host).textContent;
