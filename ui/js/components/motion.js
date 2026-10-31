// Study Tracker v3 - 動きの共通部品
// タブの切り替え・記録ログの並び替え・統計の期間切り替え・カレンダーの月切り替えなどで使う。
// 動きには緩急をつける: 出てくる動きは勢いよく入ってゆっくり止まる(EASE_OUT)、消える動きはゆっくり始まって加速する(EASE_IN)。

export const EASE_OUT = "cubic-bezier(.22, 1, .36, 1)";
export const EASE_IN = "cubic-bezier(.4, 0, 1, 1)";
export const EASE_INOUT = "cubic-bezier(.4, 0, .2, 1)"; // 場所が詰まる動き(退場で後ろの要素が上がってくるなど)

export const reduceMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const canAnimate = (el) => el && typeof el.animate === "function";

// 見えている(表示されている)要素だけを対象にする。ポップアップ(.modal-overlay)は対象外。
export function visibleBlocks(parent) {
  return [...parent.children].filter((el) => !el.classList.contains("modal-overlay") && el.getClientRects().length > 0);
}

// 要素を上から順に、フェードインしながら下から上へスライドさせて登場させる。
//  - fill:"backwards" … 順番待ちのあいだも「透明・下」の状態を保つ。終わったあとは何も残さない。
//  - 下のほうの要素は、ずれを増やさない(長い画面で待たせないため)。
export function staggerIn(elements, { distance = 18, duration = 480, step = 50, max = 10, delay = 0 } = {}) {
  if (reduceMotion()) return;
  elements.filter(canAnimate).forEach((el, i) => {
    el.animate(
      [{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: "translateY(0)" }],
      { duration, delay: delay + Math.min(i, max) * step, easing: EASE_OUT, fill: "backwards" }
    );
  });
}

// 要素を左右どちらかへ少しスライドしながらフェードアウトさせる。dir: +1 なら左へ(次へ進む動き)、-1 なら右へ。
// 戻り値の Animation は、描き直す直前に cancel() すること(fill:"forwards" で透明のまま残るため)。
export function slideOut(el, dir, { distance = 16, duration = 130 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return null;
  return el.animate(
    [{ opacity: 1, transform: "translateX(0)" }, { opacity: 0, transform: `translateX(${-dir * distance}px)` }],
    { duration, easing: EASE_IN, fill: "forwards" }
  );
}

// 要素を、反対側から少しスライドしながらフェードインさせる。dir: +1 なら右から(次へ進む動き)、-1 なら左から。
export function slideIn(el, dir, { distance = 16, duration = 300 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return;
  el.animate(
    [{ opacity: 0, transform: `translateX(${dir * distance}px)` }, { opacity: 1, transform: "translateX(0)" }],
    { duration, easing: EASE_OUT, fill: "backwards" }
  );
}

// アニメーションが終わるのを待つ(中断されたり、アニメーションが無い場合はすぐに戻る)
export async function finished(anim) {
  if (!anim) return;
  try { await anim.finished; } catch { /* cancel された */ }
}

// 高さ・余白・枠を「0」と「元の大きさ」の間で動かすためのキーフレーム(growIn / shrinkOut で共通)
const EDGE = ["marginTop", "marginBottom", "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"];
function collapsedFrame(scale) {
  const f = { height: "0px", opacity: 0, transform: `scale(${scale})`, overflow: "hidden", boxSizing: "border-box" };
  for (const p of EDGE) f[p] = "0px";
  return f;
}
function fullFrame(el) {
  const cs = getComputedStyle(el);
  const f = { height: `${el.getBoundingClientRect().height}px`, opacity: 1, transform: "scale(1)", overflow: "hidden", boxSizing: "border-box" };
  for (const p of EDGE) f[p] = cs[p];
  return f;
}

// 追加された要素を、周りの要素を押しのけながら、拡大・フェードインで出現させる。
// 高さ・余白・枠を 0 から元の大きさまで広げるので、後ろの要素が滑らかに押し出される(レイアウトごと動く)。
// 終わったあとは何も残さない。
export function growIn(el, { duration = 480, from = 0.9 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return;
  el.animate([collapsedFrame(from), fullFrame(el)], { duration, easing: EASE_OUT, fill: "backwards" });
}

// 削除される要素を、縮小・フェードアウトしながら消す(growIn の逆)。高さ・余白も 0 まで縮むので、
// 後ろの要素が滑らかに上がってくる。戻り値の Animation は fill:"forwards" で消えた状態を保つ。
// 要素を取り除く(描き直す)ときに、必要なら cancel() すること。動かさない設定のときは null。
export function shrinkOut(el, { duration = 360, to = 0.9 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return null;
  const anim = el.animate([fullFrame(el), collapsedFrame(to)], { duration, easing: EASE_INOUT, fill: "forwards" });
  el.style.pointerEvents = "none"; // 消えていく途中の要素は、もう押せない(同じ削除をもう一度開かない)
  return anim;
}

// 拡大縮小(transform)を含まないフレーム(領域の展開/折りたたみ用)
const noScale = (f) => { const { transform, ...rest } = f; return rest; };

// 非表示だった領域(display:none → block にした直後の要素)を、高さを広げながらフェードインさせ、
// 中身は上から順にフェードイン+スライドで出す(通常のタブが出るときと同じ演出)。高度な設定・ガイドの展開などで使う。
// 余白・枠も 0 から広げるので、枠のあるボックスでも、最初に枠の分だけぱっと現れない。
export function expandIn(el, { duration = 460 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return;
  el.animate([noScale(collapsedFrame(1)), noScale(fullFrame(el))], { duration, easing: EASE_OUT });
  staggerIn(visibleBlocks(el), { distance: 14, duration: 460, step: 45, delay: 40 });
}

// expandIn の逆: 高さを縮めながらフェードアウトする。戻り値の Animation は fill:"forwards"。
// 終わったら、呼び出し側が要素を隠して(display:none にして)から cancel() すること。
export function collapseOut(el, { duration = 280 } = {}) {
  if (reduceMotion() || !canAnimate(el)) return null;
  return el.animate([noScale(fullFrame(el)), noScale(collapsedFrame(1))], { duration, easing: EASE_INOUT, fill: "forwards" });
}

// ── 並びが変わるときの、滑らかな移動(FLIP) ──
// 並び替えの前に captureRects() で位置を記録し、DOM を更新したあとに playFlip() を呼ぶと、
// 要素が元の位置から新しい位置へ滑らかに移動する。対象は data-flip="キー" を持つ要素。
// 同じキーの要素が別の形(例: 報酬のカード → 目標カード)に変わった場合は、元の位置から現れるように動く。
export function captureRects(root) {
  const rects = new Map();
  root.querySelectorAll("[data-flip]").forEach((el) => rects.set(el.dataset.flip, el.getBoundingClientRect()));
  return rects;
}

export function playFlip(root, first, { duration = 460 } = {}) {
  if (reduceMotion()) return;
  root.querySelectorAll("[data-flip]").forEach((el) => {
    const f = first.get(el.dataset.flip);
    if (!f || !canAnimate(el)) return;               // 新しく現れた要素は、ここでは動かさない
    const l = el.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    const morphed = Math.abs(f.width - l.width) > 2 || Math.abs(f.height - l.height) > 2;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !morphed) return;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)`, opacity: morphed ? 0.35 : 1 }, { transform: "translate(0, 0)", opacity: 1 }],
      { duration, easing: EASE_OUT }
    );
  });
}

// ── 現れる/消える(横方向・縦方向) ──
// 要素を、幅(または高さ)・余白・枠を 0 と元の大きさの間で動かしながら、フェードで出し入れする。
//  - revealX: ボタンやメモが「横に伸びながらフェードして現れる / 縮みながら消える」(同じ行の、ほかの要素が滑らかにずれる)
//  - revealY: 行が「高さが動いて現れる / 消える」(上や下の要素が滑らかにずれる)
// 消えたあとは hidden 属性で隠す(CSS の [hidden]{display:none})。途中でもう一度逆向きに呼ばれたら、その場から逆再生する。
// 「動きを減らす」設定のとき・Web Animations が使えないとき(テスト環境など)は、すぐに切り替える。
const X_EDGE = ["marginLeft", "marginRight", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"];
const Y_EDGE = ["marginTop", "marginBottom", "paddingTop", "paddingBottom", "borderTopWidth", "borderBottomWidth"];

function axisFrames(el, axis) {
  const dim = axis === "x" ? "width" : "height";
  const edges = axis === "x" ? X_EDGE : Y_EDGE;
  const cs = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const hidden = { [dim]: "0px", opacity: 0, overflow: "hidden", boxSizing: "border-box" };
  const full = { [dim]: `${axis === "x" ? rect.width : rect.height}px`, opacity: 1, overflow: "hidden", boxSizing: "border-box" };
  for (const p of edges) { hidden[p] = "0px"; full[p] = cs[p]; }
  return { hidden, full };
}

function reveal(el, show, axis, { duration = 320 } = {}) {
  const rx = el._reveal;
  if (rx && rx.anim.playState === "running") {
    if (rx.show === show) return;
    rx.show = show;
    rx.anim.reverse(); // 終わったときの後始末は、作ったときの onfinish が rx.show を見て行う
    return;
  }
  if (rx) { rx.anim.cancel(); el._reveal = null; }
  if (show === !el.hidden) return;                       // すでにその状態
  if (reduceMotion() || !canAnimate(el) || !el.isConnected) { el.hidden = !show; return; }
  if (show) el.hidden = false;                          // 測るために、先に表示させる
  const { hidden, full } = axisFrames(el, axis);
  const anim = el.animate(show ? [hidden, full] : [full, hidden], { duration, easing: show ? EASE_OUT : EASE_INOUT, fill: "both" });
  const state = { anim, show };
  el._reveal = state;
  anim.onfinish = () => {
    anim.cancel();
    if (el._reveal === state) el._reveal = null;
    el.hidden = !state.show;
  };
}
export const revealX = (el, show, opts) => reveal(el, show, "x", opts);
export const revealY = (el, show, opts) => reveal(el, show, "y", opts);
