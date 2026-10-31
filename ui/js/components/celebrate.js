// Study Tracker v3 - 控えめな達成演出(インク/金/朱の粒子 + 金のリング + トースト)
// ストップウォッチの保存・ショップでの交換など、達成感を出したい操作で呼ぶ。

export function burst(x, y) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["var(--gold)", "var(--stamp)", "var(--ink)"];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const p = document.createElement("span");
    const size = 4 + Math.random() * 5;
    p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${colors[i % 3]};border-radius:${i % 2 ? "50%" : "0"};pointer-events:none;z-index:200;`;
    document.body.appendChild(p);
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 65 + Math.random() * 80;
    const dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist - 10;
    p.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.4)`, opacity: 0 },
      ],
      { duration: 750 + Math.random() * 300, easing: "cubic-bezier(.2,.7,.3,1)" }
    ).onfinish = () => p.remove();
  }
  const ring = document.createElement("span");
  ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:26px;height:26px;border:2px solid var(--gold);border-radius:50%;pointer-events:none;z-index:200;`;
  document.body.appendChild(ring);
  ring.animate(
    [
      { transform: "translate(-50%,-50%) scale(1)", opacity: 0.8 },
      { transform: "translate(-50%,-50%) scale(5.5)", opacity: 0 },
    ],
    { duration: 700, easing: "ease-out" }
  ).onfinish = () => ring.remove();
}

let currentToast = null; // 表示中のトースト。新しいトーストが出るときは、前のものを消す(連打で積み重ならない)

export function showToast(msg) {
  if (currentToast) { currentToast.remove(); currentToast = null; }
  const t = document.createElement("div");
  currentToast = t;
  t.textContent = msg;
  t.style.cssText =
    "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:var(--ink);color:var(--paper);font-size:12px;padding:9px 18px;z-index:210;pointer-events:none;";
  document.body.appendChild(t);
  t.animate(
    [
      { opacity: 0, transform: "translate(-50%,8px)", easing: "cubic-bezier(.22,1,.36,1)" },
      { opacity: 1, transform: "translate(-50%,0)", offset: 0.15 },
      { opacity: 1, offset: 0.8, easing: "cubic-bezier(.4,0,1,1)" },
      { opacity: 0 },
    ],
    { duration: 1800 }
  ).onfinish = () => { t.remove(); if (currentToast === t) currentToast = null; };
}

export function celebrateAt(el, msg) {
  const r = el.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
  showToast(msg);
}
