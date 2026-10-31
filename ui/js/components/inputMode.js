// 入力方法の判定: いま触っているのが「タッチ」か「マウス」かを、<html> の is-touch クラスで表す。
//
// 目的: タッチ操作では、指を離したあとも :hover が残り続けて、ホバーのハイライトが消えない。
// CSS の @media (any-hover:hover) だけでは、タッチ画面つきのパソコン・Chromebook(マウスもある端末)に効かないため、
// 触ったあとの間だけ is-touch を付けて、ホバーの見た目を無効にする(CSS 側の書き方は components.css の注釈を参照)。
//
//  ・タッチで画面を押したら付ける。マウスで押したり、マウスを実際に動かしたら外す。
//  ・タッチ後にブラウザが合成する「同じ位置のマウス移動」では、外さない(位置が変わったときだけ外す)。
//  ・JS 側のホバー表示(星評価・カレンダーの吹き出し)も、isTouchInput() を見て、タッチ中は出さない。

export const TOUCH_CLASS = "is-touch";

export const isTouchInput = (doc = document) => doc.documentElement.classList.contains(TOUCH_CLASS);

export function initInputMode(doc = document) {
  const root = doc.documentElement;
  const set = (on) => root.classList.toggle(TOUCH_CLASS, on);
  let last = null;                                     // 直前のマウスの位置

  doc.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") set(true);
    else if (e.pointerType === "mouse") { last = { x: e.clientX, y: e.clientY }; set(false); }
  }, true);

  doc.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const moved = last === null || Math.abs(e.clientX - last.x) + Math.abs(e.clientY - last.y) >= 2;
    last = { x: e.clientX, y: e.clientY };
    if (moved) set(false);
  }, true);
}
