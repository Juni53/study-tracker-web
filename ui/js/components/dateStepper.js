// Study Tracker v3 - 日付入力欄の「＋/−」ボタン
// 年・月・日の各入力欄の右に、縦に並んだ小さな「＋」「−」を付ける。押すと、その単位の日付を1つ進める/戻す。
//  - 日: 月末の「＋」で翌月1日へ、月初の「−」で前月の末日へ(月・年の欄も一緒に変わる)
//  - 月: 12月の「＋」で翌年1月へ。移動先の月に無い日付(31日など)は、その月の末日に丸める
//  - 年: そのまま±1(2月29日は、うるう年でなければ28日に丸める)
//  - 長押しすると連続して変わる。キーボード(Tab で移動して Enter/Space)でも押せる。
// 入力欄が空・不正なときは、今日の日付を起点にする。変更したら input イベントを発火する。

const MIN_YEAR = 1000, MAX_YEAR = 9999;
const HOLD_DELAY = 400, HOLD_INTERVAL = 70; // ms

const daysIn = (y, m) => new Date(y, m, 0).getDate();
const pad = (n, w) => String(n).padStart(w, "0");

function readDate(yEl, mEl, dEl) {
  const now = new Date();
  let y = parseInt(yEl.value, 10), m = parseInt(mEl.value, 10), d = parseInt(dEl.value, 10);
  if (!(y >= MIN_YEAR && y <= MAX_YEAR)) y = now.getFullYear();
  if (!(m >= 1 && m <= 12)) m = now.getMonth() + 1;
  if (!(d >= 1 && d <= 31)) d = now.getDate();
  return { y, m, d: Math.min(d, daysIn(y, m)) };
}

export function stepDate(date, unit, delta) {
  let { y, m, d } = date;
  if (unit === "y") {
    y += delta;
    if (y >= MIN_YEAR && y <= MAX_YEAR) d = Math.min(d, daysIn(y, m));
  } else if (unit === "m") {
    m += delta;
    if (m > 12) { m = 1; y++; } else if (m < 1) { m = 12; y--; }
    if (y >= MIN_YEAR && y <= MAX_YEAR) d = Math.min(d, daysIn(y, m));
  } else {
    d += delta;
    if (d > daysIn(y, m)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    else if (d < 1) { m--; if (m < 1) { m = 12; y--; } if (y >= MIN_YEAR && y <= MAX_YEAR) d = daysIn(y, m); }
  }
  // 扱える年の範囲(1000〜9999)を超えるときは、日付を変えない(上限・下限で止まる)
  if (y < MIN_YEAR || y > MAX_YEAR) return { y: date.y, m: date.m, d: date.d };
  return { y, m, d };
}

// yEl / mEl / dEl: 年・月・日の <input>(同じ .date-row の中にある想定)
export function attachDateSteppers(yEl, mEl, dEl) {
  const write = ({ y, m, d }) => {
    yEl.value = pad(y, 4); mEl.value = pad(m, 2); dEl.value = pad(d, 2);
    [yEl, mEl, dEl].forEach((el) => el.dispatchEvent(new Event("input", { bubbles: true })));
  };
  const step = (unit, delta) => write(stepDate(readDate(yEl, mEl, dEl), unit, delta));

  for (const [input, unit, label] of [[yEl, "y", "年"], [mEl, "m", "月"], [dEl, "d", "日"]]) {
    const wrap = document.createElement("span");
    wrap.className = "ds";
    const btns = document.createElement("span");
    btns.className = "ds-btns";
    btns.innerHTML = `<button type="button" class="ds-btn" data-delta="1" aria-label="${label}を1つ進める">+</button>` +
                     `<button type="button" class="ds-btn" data-delta="-1" aria-label="${label}を1つ戻す">−</button>`;
    input.replaceWith(wrap);
    wrap.append(input, btns);

    btns.querySelectorAll(".ds-btn").forEach((btn) => {
      const delta = Number(btn.dataset.delta);
      let hold = null, repeat = null;
      const stop = () => { clearTimeout(hold); clearInterval(repeat); hold = repeat = null; };
      btn.addEventListener("pointerdown", (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        step(unit, delta);
        hold = setTimeout(() => { repeat = setInterval(() => step(unit, delta), HOLD_INTERVAL); }, HOLD_DELAY);
      });
      ["pointerup", "pointerleave", "pointercancel", "blur"].forEach((ev) => btn.addEventListener(ev, stop));
      // マウス(detail>0)は pointerdown で処理済み。キーボード(detail===0)の Enter/Space はここで処理する
      btn.addEventListener("click", (e) => { if (e.detail === 0) step(unit, delta); });
    });
  }
}
