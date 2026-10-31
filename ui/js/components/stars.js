// Study Tracker v3 - 充実度の★(保存ポップアップ)
//
//  ・ホバー: カーソルを置いた星までが、フェードでプレビュー点灯する(まだ選んでいない星は薄く点く)。離すと元に戻る。
//  ・クリック: 変わる星が、左から順に 30ms ずつずらしてフェードし、最後に、選んだ星が小さく弾む。
//  ・星は ☆(枠)の上に ★ を重ね、★ の不透明度を CSS の transition でフェードさせる(.star.on / .star.pv。components.css)。
//  ・「動きを減らす」設定・Web Animations が使えない環境では、フェードの時間差も弾みもなく、すぐに切り替わる。

import { reduceMotion, EASE_OUT } from "./motion.js";
import { isTouchInput } from "./inputMode.js";

export const STAGGER_MS = 30;
export const BOUNCE_MS = 320;

// 各星の状態: "on"(選んだ値までの点灯) / "pv"(ホバーのプレビューだけで点いている) / "off"
// hover が null なら、選んだ値だけで決まる。hover があるなら、その星まで(hover)が点き、うち選んだ値以内が "on"、超える分が "pv"
export function starStates(value, hover, max = 5) {
  return Array.from({ length: max }, (_, k) => {
    const i = k + 1;
    if (hover == null) return i <= value ? "on" : "off";
    if (i > hover) return "off";
    return i <= value ? "on" : "pv";
  });
}

// 状態が変わる星に、左から順に step ms ずつ遅れを付ける。戻り値は { 星の番号(0始まり): 遅れ(ms) }
export function staggerDelays(before, after, step = STAGGER_MS) {
  const delays = {};
  let rank = 0;
  after.forEach((st, k) => { if (st !== before[k]) delays[k] = rank++ * step; });
  return delays;
}

export function starsHtml(max = 5) {
  let out = "";
  for (let i = 1; i <= max; i++) out += `<span class="star" data-value="${i}"><span class="star-o">☆</span><span class="star-f">★</span></span>`;
  return out;
}

export function mountStars(containerEl, { value = 3, max = 5, onChange = null } = {}) {
  containerEl.innerHTML = starsHtml(max);
  const stars = [...containerEl.querySelectorAll(".star")];
  let current = value;
  let hover = null;
  let clearTimer = null;

  const apply = (states, delays = null) => {
    stars.forEach((el, k) => {
      el.style.transitionDelay = ""; // 子要素(.star-f)に効かせるので、遅れは .star-f に付ける
      const f = el.querySelector(".star-f");
      f.style.transitionDelay = delays && delays[k] != null ? `${delays[k]}ms` : "";
      el.classList.toggle("on", states[k] === "on");
      el.classList.toggle("pv", states[k] === "pv");
    });
  };
  const render = () => apply(starStates(current, hover, max));

  containerEl.addEventListener("mouseover", (e) => {
    if (isTouchInput()) return;          // タッチのあとにブラウザが合成するマウスイベントでは、プレビューを出さない(残り続けるため)
    const star = e.target.closest(".star");
    if (!star || !containerEl.contains(star)) return;
    const n = parseInt(star.dataset.value, 10);
    if (hover === n) return;
    clearTimeout(clearTimer);
    hover = n;
    render();
  });
  containerEl.addEventListener("mouseleave", () => {
    if (hover == null) return;
    hover = null;
    render();
  });

  containerEl.addEventListener("click", (e) => {
    const star = e.target.closest(".star");
    if (!star || !containerEl.contains(star)) return;
    const n = parseInt(star.dataset.value, 10);
    const before = starStates(current, hover, max);
    current = n;
    hover = n; // クリックした星の上にカーソルがあるので、プレビューも同じ位置のまま
    const after = starStates(current, hover, max);

    const motion = !reduceMotion() && typeof star.animate === "function";
    const delays = motion ? staggerDelays(before, after) : null;
    apply(after, delays);
    if (motion) {
      const changed = Object.keys(delays).length;
      // 最後の星のフェードが始まって少しあと(フェードの途中)から、選んだ星が弾む
      const delay = changed ? (changed - 1) * STAGGER_MS + 140 : 0;
      star.animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.38)", offset: 0.4 }, { transform: "scale(1)" }],
        { duration: BOUNCE_MS, delay, easing: EASE_OUT }
      );
      // 時間差は、このクリックのフェードだけに使う(次のホバーのプレビューには、遅れを付けない)
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => stars.forEach((el) => { el.querySelector(".star-f").style.transitionDelay = ""; }), changed * STAGGER_MS + 300);
    }
    if (onChange) onChange(n);
  });

  render();
  return {
    get value() { return current; },
    set(v) { current = v; hover = null; render(); },
  };
}
