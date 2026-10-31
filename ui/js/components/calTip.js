// Study Tracker v3 - カレンダーのホバー概要(カード)
//
// ・カードは1枚だけ。表示中に別の日へ移っても作り直さず、その1枚が、次の日の位置とサイズへ変形しながら移動する。
//     位置(left/top)とサイズ(width/height)は、同じ時間(MOVE_MS)・同じイージング(MOVE_EASE)で動かす。
// ・中身は「旧→新」のフェード入れ替え(旧は FADE_OUT_MS で消え、新は FADE_IN_MS で現れる)。
// ・中身(記録・フッター)はカードの下端に揃えて置く(.cal-tip-layer は bottom:0)。高さが変わるときは上側だけが伸び縮みし
//   (縮むときは上の部分が隠れ、伸びるときは上へ現れる)、同じ週(行)の中の移動ではカードの下端の縦位置が動かない。
//   フッター(日付・合計)は縦に動かず、フェードで入れ替わって見える。別の週(行)へ縦に移るときは、下端も一緒に動く。
// ・横にも、次の日のセルの真上へ滑らかに移動する(日付もカードと一緒に動く)。中身の幅は日によって違うので、カードの幅も同時に変わる。
// ・基本はセルの上に出す。上に収まらないときは下。左右は画面端からはみ出さないよう補正する。
// ・初めて出るとき・消えるときは、拡大+フェード(出るとき 240ms / 消えるとき 150ms)。
// ・「動きを減らす」設定・Web Animations が使えない環境では、すべて即座に切り替える。

import { reduceMotion, EASE_OUT, EASE_IN } from "./motion.js";

export const MOVE_MS = 200;
export const MOVE_EASE = "cubic-bezier(.3,.7,.2,1)"; // 最初は素早く、終わりにゆっくり止まる
export const FADE_OUT_MS = 160;
export const FADE_IN_MS = 260;
export const SHOW_DELAY_MS = 90;   // 通りすがりでちらつかないよう、少し待ってから出す(出ているあいだ、隣のセルへは待たない)
export const GAP_HIDE_MS = 60;     // セルのあいだの隙間を通るだけなら消さない
const WEEKDAYS = "日月火水木金土";

// 日の概要の中身。戻り値は { body, footer }(HTML 文字列)。記録も試験日も無い日は null(さぼり券だけの日を含む)
//   body   … 試験日・記録の先頭3件(ほかN件)・連続ボーナス
//   footer … 日付と合計(記録があれば「合計 時間 ・ 件数 ・ ポイント」)
export function buildTipParts(day, iso, { tagById = () => null, esc = (s) => s, fmtHM = (m) => `${m}m`, nowYear = new Date().getFullYear() } = {}) {
  if (!day) return null;
  const recs = day.records || [];
  const exams = day.exams || [];
  if (!recs.length && !exams.length) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const dateText = `${y === nowYear ? "" : `${y}年`}${m}月${d}日(${wd})`;

  let body = "";
  exams.forEach((e) => { body += `<div class="cal-tip-exam">⚑ 試験日: ${esc(e.name)}</div>`; });
  if (recs.length) {
    const shown = recs.slice(0, 2).map((r) => {
      const names = (r.tag_ids || []).map(tagById).filter(Boolean).map((t) => t.name).join("・");
      const label = r.content || names;
      return `<div class="cal-tip-rec"><span class="t mono">${fmtHM(r.minutes)}</span><span class="n${label ? "" : " dim"}">${label ? esc(label) : "タイトルなし"}</span></div>`;
    }).join("");
    body += `<div class="cal-tip-recs">${shown}${recs.length > 2 ? `<div class="cal-tip-more">ほか ${recs.length - 2}件</div>` : ""}</div>`;
  }
  (day.milestones || []).forEach((ms) => { body += `<div class="cal-tip-mile">🏅 連続${ms.streak}日達成ボーナス +${ms.points}P</div>`; });

  const total = recs.length ? `<span class="s mono">合計 ${fmtHM(day.minutes)} ・ ${recs.length}件 ・ +${(day.points || 0).toFixed(1)}P</span>` : "";
  return { body, footer: `<div class="cal-tip-foot"><span class="d">${dateText}</span>${total}</div>` };
}

// カードの置き場所。rect = セルの位置、(w, h) = カード全体の大きさ、(vw, vh) = 画面の大きさ
export function tipGeometry(rect, w, h, vw, vh, { gap = 6, margin = 14 } = {}) {
  const above = rect.top - h - gap >= margin;
  const top = Math.max(margin, above ? rect.top - h - gap : Math.min(rect.bottom + gap, vh - h - margin));
  const cx = rect.left + rect.width / 2;
  const left = Math.max(margin, Math.min(vw - w - margin, cx - w / 2));
  return { left, top, above, originX: Math.max(0, Math.min(w, cx - left)), originY: above ? h : 0 };
}

export function createCalTip({ partsOf }) {
  const doc = document;
  const view = doc.defaultView;
  const card = doc.createElement("div");
  card.className = "cal-tip";
  card.setAttribute("role", "tooltip");
  doc.body.appendChild(card);

  let visible = false, popAnim = null, timer = null, cell = null;
  let layers = [];
  const canMove = () => !reduceMotion() && typeof card.animate === "function";

  function makeLayer(parts) {
    const el = doc.createElement("div");
    el.className = "cal-tip-layer";
    el.innerHTML = `${parts.body}${parts.footer}`;
    el.style.width = "max-content"; // 自然な大きさを測る(測ったあと、その幅に固定する)
    card.appendChild(el);
    return el;
  }

  function dropLayer(el) { el.remove(); layers = layers.filter((l) => l !== el); }

  // 旧い中身を、いまの不透明度から FADE_OUT_MS でフェードアウトして取り除く
  function fadeOutLayer(el) {
    if (!canMove()) { dropLayer(el); return; }
    const from = parseFloat(view.getComputedStyle(el).opacity);
    const a = el.animate([{ opacity: Number.isFinite(from) ? from : 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: "linear", fill: "forwards" });
    a.onfinish = () => dropLayer(el);
  }

  function setGeometry(g, w, h) {
    card.style.left = `${g.left}px`;
    card.style.top = `${g.top}px`;
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.transformOrigin = `${g.originX}px ${g.originY}px`;
  }

  function show(target) {
    const parts = partsOf(target.dataset.date);
    if (!parts) { hide(); return; }
    clearTimeout(timer);
    const old = layers.slice();
    const layer = makeLayer(parts);
    layers.push(layer);
    // 小数の幅を切り捨てて右端が欠けないよう、切り上げて測る
    const lr = layer.getBoundingClientRect();
    const lw = Math.ceil(lr.width || layer.offsetWidth), lh = Math.ceil(lr.height || layer.offsetHeight);
    layer.style.width = `${lw}px`;
    const w = lw + 2, h = lh + 2; // 枠(1px)ぶん
    // 画面の幅は、スクロールバーを除いた表示領域で見る(右端のセルで、カードがバーの下に隠れないように)
    const vw = doc.documentElement.clientWidth || view.innerWidth;
    const vh = doc.documentElement.clientHeight || view.innerHeight;
    const g = tipGeometry(target.getBoundingClientRect(), w, h, vw, vh);
    cell = target;

    if (!visible) {
      old.forEach(dropLayer);
      visible = true;
      if (popAnim) { popAnim.cancel(); popAnim = null; }
      card.style.transition = "none";
      setGeometry(g, w, h);
      card.style.visibility = "visible";
      card.style.opacity = "1";
      if (canMove()) {
        popAnim = card.animate(
          [{ opacity: 0, transform: "scale(.86)" }, { opacity: 1, transform: "scale(1)" }],
          { duration: 240, easing: EASE_OUT }
        );
      }
      return;
    }

    // 出ているカードを、次の日の位置とサイズへ変形しながら移動する(位置とサイズは同じ時間・同じイージング)
    if (popAnim) { popAnim.cancel(); popAnim = null; }
    card.style.visibility = "visible";
    card.style.opacity = "1";
    if (canMove()) {
      card.style.transition = ["left", "top", "width", "height"].map((p) => `${p} ${MOVE_MS}ms ${MOVE_EASE}`).join(", ");
      old.forEach(fadeOutLayer);
      layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: EASE_OUT, fill: "backwards" });
    } else {
      card.style.transition = "none";
      old.forEach(dropLayer);
    }
    setGeometry(g, w, h);
  }

  function hide() {
    clearTimeout(timer);
    cell = null;
    if (!visible) return;
    visible = false;
    if (popAnim) { popAnim.cancel(); popAnim = null; }
    const done = () => {
      if (visible) return;
      card.style.visibility = "hidden";
      card.style.opacity = "0";
      card.style.transition = "none";
      [...layers].forEach(dropLayer);
    };
    if (!canMove()) { done(); return; }
    const a = card.animate(
      [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(.9)" }],
      { duration: 150, easing: EASE_IN, fill: "forwards" }
    );
    popAnim = a;
    a.onfinish = () => { done(); if (popAnim === a) { a.cancel(); popAnim = null; } };
  }

  // マウスが乗ったセル(無ければ null)。出ているあいだは待たずに隣へ移る。無いときは、隙間を通るだけかもしれないので少し待って消す
  function hover(target) {
    if (target && target === cell && visible) return;
    clearTimeout(timer);
    if (!target) { timer = setTimeout(hide, GAP_HIDE_MS); return; }
    if (visible) show(target);
    else timer = setTimeout(() => show(target), SHOW_DELAY_MS);
  }

  function destroy() { clearTimeout(timer); card.remove(); }

  return { show, hide, hover, destroy, el: card, get visible() { return visible; }, get layerCount() { return layers.length; } };
}
