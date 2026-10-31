// Study Tracker v3 - カレンダータブ(ヒートマップ)
// app.js の NAV キーが "cal" なので、ルーターは ./views/cal.js を読み込む(calendar.js ではない)。
// 集計・判定は Python 側(data_manager.calendar_month)で済ませてあり、ここでは並べて描くだけ。

import { isTouchInput } from "../components/inputMode.js";
import { mountPoints } from "../components/points.js";
import { slideIn, slideOut, finished } from "../components/motion.js";
import { createCalTip, buildTipParts } from "../components/calTip.js";
import { clock } from "../core/dates.js";

const WEEK_START = 0;               // 0 = 日曜始まり(デザイン案どおり) / 1 = 月曜始まり
const HEAT_STEPS = [60, 120, 180];  // 分。濃さ1: 0〜1h未満 / 2: 〜2h未満 / 3: 〜3h未満 / 4: 3h以上
const WEEKDAYS = "日月火水木金土";

let viewToken = 0;      // タブを離れた/開き直した後に、古い非同期処理が描画しないための印
let popupEl = null;     // 日別ポップアップ(body 直下に置く。下の openDay のコメント参照)
let tipEl = null;       // ホバーの概要(body 直下)
let cleanups = [];      // 離れるときに外すもの(window のイベントなど)

function teardown() {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  if (popupEl) { popupEl.remove(); popupEl = null; }
  tipEl = null;
}
export function onLeave() {
  viewToken++;
  teardown();
}

const pad2 = (n) => String(n).padStart(2, "0");
function todayIso() {
  const d = clock.now();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${pad2(m)}m` : `${m}m`;
}
// 今年と同じなら月/日のみ、違う年なら YYYY/MM/DD
function fmtDate(iso, todayY) {
  const [y, m, d] = iso.split("-");
  return y === String(todayY) ? `${m}/${d}` : `${y}/${m}/${d}`;
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
function toHalfWidth(s) {
  return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[．，]/g, ".");
}
function levelOf(min) {
  if (min <= 0) return 0;
  if (min < HEAT_STEPS[0]) return 1;
  if (min < HEAT_STEPS[1]) return 2;
  if (min < HEAT_STEPS[2]) return 3;
  return 4;
}
// 日付の加算は UTC で行う(夏時間などでずれないように)
const toUtc = (iso) => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const isoOfUtc = (t) => new Date(t).toISOString().slice(0, 10);

// 今月の目標ゲージ。ホームと同じ考え方: 超えたら100%に目盛り、超過分は金色。
function goalMeterHtml(label, doneMin, goalMin) {
  const ratio = goalMin ? doneMin / goalMin : 0;
  if (ratio <= 1) {
    return `<div class="meter-row"><div class="lbl">${label}</div>
      <div class="meter-track"><div class="meter-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
      <div class="val mono"><b>${fmtHM(doneMin)}</b> / ${fmtHM(goalMin)}</div></div>`;
  }
  const tickPos = (100 / (ratio * 100)) * 100;
  return `<div class="meter-row"><div class="lbl">${label}</div>
    <div class="meter-track overshoot">
      <div class="meter-fill" style="width:${tickPos}%"></div>
      <div class="meter-over" style="width:${100 - tickPos}%"></div>
      <span class="meter-tick" style="left:${tickPos}%"></span>
    </div>
    <div class="val mono"><b class="over">${fmtHM(doneMin)}</b> / ${fmtHM(goalMin)}</div></div>`;
}

export async function render(root, api) {
  const token = ++viewToken;
  teardown();

  const now0 = clock.now();
  let year = now0.getFullYear();
  let month = now0.getMonth() + 1;
  let data = null;
  let reqId = 0;

  const $ = (sel) => root.querySelector(sel);
  const alive = () => token === viewToken;

  root.innerHTML = `
    <div class="top"><h1>カレンダー</h1><div class="right"><span class="pts mono" id="calPts">…</span></div></div>

    <div class="cal-header">
      <div class="cal-nav">
        <button class="cal-navbtn" id="calPrev" title="前の月">‹</button>
        <span class="cal-month mono" id="calMonth"></span>
        <button class="cal-navbtn" id="calNext" title="次の月">›</button>
        <button class="cal-gotoday" id="calToday">今月</button>
      </div>
      <div class="cal-stats mono" id="calStats"></div>
    </div>

    <div class="cal-streak" id="calStreak"></div>

    <div class="cal-legend"><span>少</span>${[0, 1, 2, 3, 4].map((i) => `<span class="cal-lg cal-lv${i}"></span>`).join("")}<span>多</span></div>

    <div class="cal-weekrow">${Array.from({ length: 7 }, (_, i) => `<div class="cal-weekday">${WEEKDAYS[(WEEK_START + i) % 7]}</div>`).join("")}</div>
    <div class="cal-grid" id="calGrid"></div>

    <div class="cal-goal" id="calGoal"></div>
  `;

  // 日別ポップアップは #content の外(body 直下)に置く。
  // #content は container-type:inline-size なので、その中の position:fixed は
  // ウィンドウではなく #content を基準にされる可能性があり、スクロール位置によって
  // ポップアップが画面外に出るのを避けるため。
  popupEl = document.createElement("div");
  popupEl.className = "modal-overlay";
  popupEl.innerHTML = `
    <div class="modal-box cal-pop">
      <button class="modal-close" data-act="close">✕</button>
      <div class="cal-pop-title" id="calPopTitle"></div>
      <div class="cal-pop-total mono" id="calPopTotal"></div>
      <div id="calPopBody"></div>
    </div>`;
  document.body.appendChild(popupEl);
  const overlay = popupEl;
  const $p = (sel) => overlay.querySelector(sel);

  // ── 読み込み / 描画 ──
  // 月の切り替えで動かす部分(月に応じて中身が変わるところ)
  const slidingEls = () => ["#calGrid", "#calStats", "#calGoal"].map((sel) => $(sel));
  let exitAnims = [];

  // dir: 月を切り替えたときの向き(+1 = 先の月へ / -1 = 前の月へ)。0 のときは動かさずに描き直す。
  // 先の月へ: 今の表示が左へ少しスライドしながら消え、新しい月が右から入ってくる(前の月へは逆向き)。
  async function load({ dir = 0 } = {}) {
    const my = ++reqId;
    tip.hide();
    if (dir) {
      exitAnims.forEach((a) => a && a.cancel());
      exitAnims = slidingEls().map((el) => slideOut(el, dir));
    }
    const fetching = (async () => {
      try {
        return await api.get_calendar_month(year, month, WEEK_START);
      } catch (e) {
        console.error(e);
        return null;
      }
    })();
    // データの取得と、いまの表示が消える動きの両方が終わるのを待つ
    const [d] = await Promise.all([fetching, ...exitAnims.map(finished)]);
    if (!alive() || my !== reqId) return; // 離脱済み、または後からの月切替に追い越された
    exitAnims.forEach((a) => a && a.cancel()); // 透明のまま残っている「消える動き」を外す
    exitAnims = [];
    if (!d) {
      $("#calGrid").innerHTML = `<div class="empty-note" style="grid-column:1/-1;">データを取得できませんでした(API エラー。ページを再読み込みしても直らない場合は、お知らせください)。</div>`;
      return;
    }
    data = d;
    paint();
    if (dir) slidingEls().forEach((el) => slideIn(el, dir));
  }

  function paint() {
    const d = data;
    mountPoints($("#calPts"), d.points_balance);
    $("#calMonth").textContent = `${d.year}年${d.month}月`;
    paintStats(d);
    paintStreak(d);
    paintGrid(d);
    paintGoal(d);
  }

  function paintStats(d) {
    const s = d.summary;
    const days = s.elapsed_days > 0 ? ` ・ ${s.studied_days}/${s.elapsed_days}日学習` : "";
    $("#calStats").textContent = `合計 ${fmtHM(s.total_min)}${days} ・ +${s.points.toFixed(1)}P`;
  }

  function paintStreak(d) {
    const s = d.streak;
    const todayY = clock.now().getFullYear();
    const sabori = s.sabori_dates.length
      ? ` ・ さぼり券使用: ${s.sabori_dates.map((x) => fmtDate(x, todayY)).join(", ")}`
      : "";
    let html;
    if (s.state === "active") {
      html = `<span class="dot live"></span><b class="mono">${s.count}日連続</b><span>${sabori}</span>`;
    } else if (s.state === "warning") {
      html = `<span class="dot"></span><b class="mono">${s.count}日連続</b><span> ・ 今日中に記録を${sabori}</span>`;
    } else {
      html = `<span class="dot idle"></span><b>連続記録は途切れています</b>`;
    }
    // 過去に続いていた連続記録(表示中の月に重なるもの。新しい順)。いま進行中のものとは別に、薄い下線で示す
    if (s.past && s.past.length) {
      const items = s.past.slice(0, 3).map((r) => `${fmtDate(r.start, todayY)}〜${fmtDate(r.end, todayY)}(${r.days}日)`).join(", ");
      const more = s.past.length > 3 ? ` ほか${s.past.length - 3}件` : "";
      html += `<span class="cal-streak-past">過去の連続記録: ${items}${more}</span>`;
    }
    $("#calStreak").innerHTML = html;
  }

  function paintGrid(d) {
    const todayStr = todayIso();
    const t0 = toUtc(d.grid_start);
    const n = Math.round((toUtc(d.grid_end) - t0) / 86400000) + 1;
    const ym = `${d.year}-${pad2(d.month)}`;
    let html = "";
    for (let i = 0; i < n; i++) {
      const iso = isoOfUtc(t0 + i * 86400000);
      const day = d.days[iso] || {};
      const inMonth = iso.startsWith(ym);
      const min = day.minutes || 0;

      const cls = ["cal-cell", `cal-lv${levelOf(min)}`];
      if (!inMonth) cls.push("outside");
      if (inMonth && iso === todayStr) cls.push("today");
      if (day.in_streak) cls.push("streak");
      else if (day.in_past_streak) cls.push("streak-past");

      const marks = [];
      if (day.sabori && !min) marks.push('<span class="cal-mk-sabori">🎟</span>');
      if (day.exams && day.exams.length) marks.push('<span class="cal-mk-exam">⚑</span>');
      if (day.milestones && day.milestones.length) marks.push('<span class="cal-mk-mile"></span>');

      const attrs = inMonth ? ` data-date="${iso}" tabindex="0"` : "";
      const label = inMonth ? ` aria-label="${parseInt(iso.slice(5, 7), 10)}月${parseInt(iso.slice(8), 10)}日${min ? ` ${fmtHM(min)}` : ""}"` : "";
      html += `<div class="${cls.join(" ")}"${attrs}${label}><span class="cal-dn mono">${parseInt(iso.slice(8), 10)}</span>${marks.join("")}</div>`;
    }
    $("#calGrid").innerHTML = html;
  }

  function paintGoal(d) {
    const t = clock.now();
    const isCurrent = d.year === t.getFullYear() && d.month === t.getMonth() + 1;
    const done = d.summary.total_min;
    const goal = d.goal.goal_min;
    const achieved = goal > 0 && done >= goal;
    const label = isCurrent ? "今月の目標" : `${d.month}月の目標`;
    const hours = Number((goal / 60).toFixed(2));

    const footer = isCurrent
      ? `<div class="cal-goal-edit">
           <span>目標時間を変更:</span>
           <input class="finput cal-goal-input mono" id="calGoalInput" value="${hours}" inputmode="decimal" autocomplete="off">
           <span>時間</span>
           <button class="btn muted small" id="calGoalBtn">更新</button>
           <span class="cal-goal-msg" id="calGoalMsg"></span>
         </div>`
      : `<div class="cal-goal-note">月の目標時間は共通の設定なので、過去・未来の月も現在の目標時間を基準に表示しています</div>`;

    $("#calGoal").innerHTML = `
      <div class="sect-lbl">${label}${achieved ? '<span class="cal-goal-badge">🏆 達成</span>' : ""}</div>
      ${goalMeterHtml("達成率", done, goal)}
      ${footer}`;
  }

  async function saveGoal() {
    const input = $("#calGoalInput");
    const msg = $("#calGoalMsg");
    if (!input || !msg) return;
    const hours = parseFloat(toHalfWidth(input.value).trim());
    if (!Number.isFinite(hours) || hours <= 0 || hours > 744) {
      msg.classList.remove("ok");
      msg.textContent = "0より大きい時間を入力してください(例: 30 や 27.5)";
      return;
    }
    const res = await api.update_setting("monthly_goal_min", Math.round(hours * 60));
    if (!alive()) return;
    if (!res || !res.ok) {
      msg.classList.remove("ok");
      msg.textContent = "更新に失敗しました";
      return;
    }
    await load(); // ゲージ・達成バッジ・今月の見出しを描き直す
    if (!alive()) return;
    const m2 = $("#calGoalMsg");
    if (m2) { m2.classList.add("ok"); m2.textContent = "更新しました"; }
  }

  // ── 日別ポップアップ ──
  function tagById(id) { return (data.tags || []).find((t) => t.id === id); }
  function examById(id) { return (data.exams || []).find((e) => e.id === id); }

  function recHtml(r) {
    const src = r.source === "stopwatch" ? "⏱" : "✏️";
    const stars = r.quality ? "★".repeat(r.quality) + "☆".repeat(5 - r.quality) : "-";
    const tagSpans = (r.tag_ids || []).map((id) => {
      const t = tagById(id);
      return t ? `<span class="rec-tagx"><span class="sw" style="background:${t.color}"></span>${esc(t.name)}</span>` : "";
    }).join("");
    const examSpans = (r.exam_ids || []).map((id) => {
      const e = examById(id);
      return e ? `<span class="rec-tagx exam"><span class="ex-flag">⚑</span>${esc(e.name)}</span>` : "";
    }).join("");
    return `
      <div class="rec">
        <div class="rec-top">
          <div class="rec-src">${src}</div>
          <div class="rec-dur mono">${fmtHM(r.minutes)}</div>
          <div class="rec-stars">${stars}</div>
          <div class="rec-pts mono">+${(r.points_earned || 0).toFixed(1)}P</div>
        </div>
        ${r.content ? `<div class="rec-content">${esc(r.content)}</div>` : ""}
        ${tagSpans || examSpans ? `<div class="rec-tags">${tagSpans}${examSpans}</div>` : ""}
      </div>`;
  }

  function openDay(iso) {
    const day = data.days[iso] || {};
    const [y, m, dd] = iso.split("-").map(Number);
    $p("#calPopTitle").textContent = y === clock.now().getFullYear() ? `${m}月${dd}日` : `${y}年${m}月${dd}日`;

    const recs = day.records || [];
    $p("#calPopTotal").textContent = recs.length ? `合計 ${fmtHM(day.minutes)} ・ +${day.points.toFixed(1)}P` : "";

    let html = "";
    (day.exams || []).forEach((e) => { html += `<div class="cal-info exam">⚑ 試験日: ${esc(e.name)}</div>`; });
    (day.milestones || []).forEach((ms) => { html += `<div class="cal-info mile">🏅 連続${ms.streak}日達成ボーナス +${ms.points}P</div>`; });
    if (recs.length) {
      html += recs.map(recHtml).join("");
    } else if (day.sabori) {
      // 注意: さぼり券はストリーク(連続記録)を守るだけで、ポイント消失の判定には関係しない(仕様)。
      html += `<div class="empty-note">🎟 さぼり券を使用しました(連続記録は継続)</div>`;
    } else {
      html += `<div class="empty-note">この日の学習記録はありません</div>`;
    }
    $p("#calPopBody").innerHTML = html;
    overlay.classList.add("open");
  }

  // ── ホバーの概要(カードは1枚。動きは components/calTip.js) ──
  // 勉強した日・試験日のセルにカーソルを置く(または Tab で来る)と、その日の概要が出る。表示中に別の日へ移ると、
  // カードがその日の位置とサイズへ変形しながら移動し、中身はフェードで入れ替わる。
  // 記録も試験日も無い日(さぼり券だけの日を含む)には出さない。body 直下に置く。
  const tip = createCalTip({
    partsOf: (iso) => buildTipParts(data && data.days[iso], iso, { tagById, esc, fmtHM }),
  });
  tipEl = tip.el;
  cleanups.push(() => tip.destroy());

  // ── イベント ──
  function shiftMonth(delta) {
    month += delta;
    if (month < 1) { month = 12; year--; }
    else if (month > 12) { month = 1; year++; }
    load({ dir: delta });
  }
  $("#calPrev").addEventListener("click", () => shiftMonth(-1));
  $("#calNext").addEventListener("click", () => shiftMonth(1));
  $("#calToday").addEventListener("click", () => {
    const t = clock.now();
    const y = t.getFullYear(), m = t.getMonth() + 1;
    if (y === year && m === month) return; // すでに今月を表示中なら、何も起きない
    const dir = (y * 12 + m) > (year * 12 + month) ? 1 : -1; // 今月が、表示中の月より先か前か
    year = y;
    month = m;
    load({ dir });
  });

  const gridEl = $("#calGrid");
  gridEl.addEventListener("mouseover", (e) => {
    if (isTouchInput()) return;          // タッチのあとにブラウザが合成するマウスイベントでは、吹き出しを出さない(残り続けるため)
    tip.hover(e.target.closest(".cal-cell[data-date]"));
  });
  gridEl.addEventListener("mouseleave", () => tip.hover(null));
  gridEl.addEventListener("focusin", (e) => {
    const cell = e.target.closest(".cal-cell[data-date]");
    if (cell && cell.matches(":focus-visible")) tip.show(cell); // キーボードで来たときだけ(クリックでは出さない)
  });
  gridEl.addEventListener("focusout", () => tip.hide());
  const onScroll = () => tip.hide();
  addEventListener("scroll", onScroll, { passive: true, capture: true });
  cleanups.push(() => removeEventListener("scroll", onScroll, { capture: true }));
  gridEl.addEventListener("click", (e) => {
    const cell = e.target.closest(".cal-cell[data-date]");
    if (cell) { tip.hide(); openDay(cell.dataset.date); }
  });
  gridEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const cell = e.target.closest(".cal-cell[data-date]");
    if (!cell) return;
    e.preventDefault();
    openDay(cell.dataset.date);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.dataset.act === "close") overlay.classList.remove("open");
  });

  const goalEl = $("#calGoal");
  goalEl.addEventListener("click", (e) => { if (e.target.closest("#calGoalBtn")) saveGoal(); });
  goalEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.id === "calGoalInput") saveGoal(); });

  await load();
}
