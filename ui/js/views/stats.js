// Study Tracker v3 - 統計タブ
// 集計・比較・割合の計算はすべて Python 側(data_manager.stats_period)で済ませてあり、
// ここでは受け取った値を並べて描くだけ(棒の長さを最大値×1.15に正規化するところだけは描画上の処理)。
// グラフは SVG ではなく幅100%の div の高さ/幅(%)で描くので、リサイズ時の再描画は要らない。

import { mountPoints } from "../components/points.js";
import { staggerIn, visibleBlocks } from "../components/motion.js";

const PERIODS = [
  { key: "week", label: "今週" },
  { key: "month", label: "今月" },
  { key: "all", label: "全期間" },
];
const PERIOD_TITLE = { week: "今週", month: "今月", all: "全期間" };
const COMPARE_HINT = { week: "先週の同じ曜日までとの比較", month: "先月の同じ日付までとの比較" };
const SLOT_LABEL = { morning: "午前", afternoon: "午後", night: "夜" };
const SLOT_ALPHA = { morning: 0.3, afternoon: 0.62, night: 0.92 };

let viewToken = 0;   // タブを離れた/開き直した後に、古い非同期処理が描画しないための印
let popupEl = null;  // 詳細統計ポップアップ(body 直下。理由はカレンダータブのコメント参照)

export function onLeave() {
  viewToken++;
  if (popupEl) { popupEl.remove(); popupEl = null; }
}

const pad2 = (n) => String(n).padStart(2, "0");
// 平均など小数の分でも「1h60m」にならないよう、先に丸めてから時・分に分ける
function fmtHM(min) {
  const t = Math.round(min);
  const h = Math.floor(t / 60), m = t % 60;
  return h ? `${h}h${pad2(m)}m` : `${m}m`;
}
// 今年と同じなら MM/DD、違う年なら YYYY/MM/DD
function fmtDate(iso, todayY) {
  const [y, m, d] = iso.split("-");
  return y === String(todayY) ? `${m}/${d}` : `${y}/${m}/${d}`;
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
// 最大値×1.15 を軸の上限にして、最大の棒が上端に張り付かないようにする(共通ルール)
function scaleOf(values) {
  return Math.max(...values, 1) * 1.15;
}

// 前期間との比較の表示。null は「比較元が無い(0)」の意味。
function pctCmp(v) {
  if (v == null) return { cls: "flat", text: "―" };
  if (v > 0) return { cls: "up", text: `▲${v}%` };
  if (v < 0) return { cls: "down", text: `▼${Math.abs(v)}%` };
  return { cls: "flat", text: "±0%" };
}
function diffCmp(v) {
  if (v == null) return { cls: "flat", text: "―" };
  if (Math.abs(v) < 0.05) return { cls: "flat", text: "±0.0" };
  return v > 0 ? { cls: "up", text: `▲${v.toFixed(1)}` } : { cls: "down", text: `▼${Math.abs(v).toFixed(1)}` };
}

export async function render(root, api) {
  const token = ++viewToken;
  if (popupEl) { popupEl.remove(); popupEl = null; }

  let period = "month";
  let data = null;
  let reqId = 0;

  const $ = (sel) => root.querySelector(sel);
  const alive = () => token === viewToken;

  root.innerHTML = `
    <div class="top"><h1>統計</h1><div class="right"><span class="pts mono" id="stPts">…</span></div></div>

    <div class="st-period" id="stPeriod">
      ${PERIODS.map((p) => `<button class="tbtn${p.key === period ? " active" : ""}" data-p="${p.key}" data-text="${p.label}">${p.label}</button>`).join("")}
    </div>

    <div class="st-overview" id="stOverview"></div>
    <div class="st-detail-row"><button class="st-detail-btn" id="stDetailBtn">詳細統計を見る →</button></div>

    <div class="sect" id="stPanel"></div>
    <div class="sect" id="stWeekday"></div>
    <div class="sect" id="stTags"></div>
    <div class="sect st-last" id="stQuality"></div>
  `;

  popupEl = document.createElement("div");
  popupEl.className = "modal-overlay";
  popupEl.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" data-act="close">✕</button>
      <div class="modal-title" id="stDetailTitle"></div>
      <div id="stDetailBody"></div>
    </div>`;
  document.body.appendChild(popupEl);
  const overlay = popupEl;

  // ── 読み込み / 描画 ──
  // animate: ユーザーが期間を切り替えたときだけ true(最初の表示はタブ切り替えの登場アニメーションが担当する)
  async function load(p, { animate = false } = {}) {
    period = p;
    const my = ++reqId;
    let d = null;
    try {
      d = await api.get_stats(p);
    } catch (e) {
      console.error(e);
    }
    if (!alive() || my !== reqId) return; // 離脱済み、または後からの切替に追い越された
    if (!d) {
      $("#stPanel").innerHTML = `<div class="empty-note">データを取得できませんでした(API エラー。ページを再読み込みしても直らない場合は、お知らせください)。</div>`;
      return;
    }
    data = d;
    paint();
    if (animate) {
      // 見出し行と期間タブは動かさず、その下の本体だけを、上から順にフェードイン+スライドで出し直す
      staggerIn(visibleBlocks(root).filter((el) => !el.classList.contains("top") && el.id !== "stPeriod"));
    }
  }

  function paint() {
    const d = data;
    mountPoints($("#stPts"), d.points_balance);
    root.querySelectorAll("#stPeriod .tbtn").forEach((b) => b.classList.toggle("active", b.dataset.p === d.period));
    paintOverview(d);
    paintPanel(d);
    paintWeekday(d);
    paintTags(d);
    paintQuality(d);
  }

  // ── 概要(4つの数字と前期間との比較) ──
  function paintOverview(d) {
    const o = d.overview;
    const c = o.compare;
    const cells = [
      { val: fmtHM(o.total_min), lbl: "総学習時間", cmp: c && pctCmp(c.total_min_pct) },
      { val: `+${o.points.toFixed(1)}`, gold: true, lbl: "獲得ポイント", cmp: c && pctCmp(c.points_pct) },
      { val: String(o.count), lbl: "記録数", cmp: c && pctCmp(c.count_pct) },
      { val: o.avg_quality == null ? "―" : `★${o.avg_quality.toFixed(1)}`, lbl: "平均充実度", cmp: c && diffCmp(c.quality_diff) },
    ];
    $("#stOverview").innerHTML = cells.map((x) => `
      <div class="st-ov-cell">
        <div class="st-ov-val mono${x.gold ? " gold" : ""}">${x.val}</div>
        <div class="st-ov-lbl">${x.lbl}</div>
        ${x.cmp ? `<div class="st-ov-cmp mono ${x.cmp.cls}" title="${COMPARE_HINT[d.period] || ""}">${c.label} ${x.cmp.text}</div>` : ""}
      </div>`).join("");
  }

  // ── 期間ごとのメインのグラフ ──
  function streakLineHtml(s, todayY) {
    const sabori = s.sabori_dates.length ? ` ・ さぼり券使用: ${s.sabori_dates.map((x) => fmtDate(x, todayY)).join(", ")}` : "";
    if (s.state === "active") return `<span class="dot live"></span><b class="mono">${s.count}日連続</b><span>${sabori}</span>`;
    if (s.state === "warning") return `<span class="dot"></span><b class="mono">${s.count}日連続</b><span> ・ 今日中に記録を${sabori}</span>`;
    return `<span class="dot idle"></span><b>連続記録は途切れています</b>`;
  }

  // 過去に続いていた連続記録(この期間に重なるもの。新しい順)。無ければ空
  function pastStreakHtml(s, todayY) {
    if (!s.past || !s.past.length) return "";
    const items = s.past.slice(0, 3).map((r) => `${fmtDate(r.start, todayY)}〜${fmtDate(r.end, todayY)}(${r.days}日)`).join(", ");
    return `<div class="st-streak-past">この期間の過去の連続記録: ${items}${s.past.length > 3 ? ` ほか${s.past.length - 3}件` : ""}</div>`;
  }

  function paintPanel(d) {
    const p = d.panel;
    const todayY = new Date().getFullYear();
    let html = "";

    if (p.kind === "week") {
      const scale = scaleOf(p.rows.map((r) => r.minutes));
      let info = "";
      if (p.elapsed_days > 1) { // 月曜の今日だけ、のときは「ここまで連続」と言っても意味が無いので出さない
        if (p.missing_dates.length === 0) {
          const sab = p.sabori_dates.length ? `(${p.sabori_dates.map((x) => fmtDate(x, todayY)).join(", ")}はさぼり券を使用)` : "";
          info = `<div class="st-streak"><span class="dot live"></span><span>今週はここまでずっと連続記録中${sab}</span></div>`;
        } else {
          info = `<div class="st-streak"><span class="dot idle"></span><span>今週は記録のない日があります: ${p.missing_dates.map((x) => fmtDate(x, todayY)).join(", ")}</span></div>`;
        }
      }
      const rows = p.rows.map((r) => {
        const [, mm, dd] = r.date.split("-");
        const dots = r.tag_ids.map((id) => {
          const t = d.tags.find((x) => x.id === id);
          return t ? `<span class="st-wk-tag" style="background:${t.color}"></span>` : "";
        }).join("");
        const width = r.minutes ? (r.minutes / scale) * 100 : 0;
        const right = r.sabori ? `<div class="st-wk-m mono sabori">🎟 使用</div>`
          : `<div class="st-wk-m mono">${r.minutes ? fmtHM(r.minutes) : "―"}</div>`;
        return `
          <div class="st-wk-row${r.is_today ? " today" : ""}">
            <div class="st-wk-d mono"><b>${mm}/${dd}</b>${r.weekday}</div>
            <div><div class="st-bar-track"><div class="st-bar-fill" style="width:${width}%"></div></div><div class="st-wk-tags">${dots}</div></div>
            ${right}
          </div>`;
      }).join("");
      html = `<div class="sect-lbl">今週のログ</div>${info}${pastStreakHtml(d.streak, todayY)}${rows}`;
    } else if (p.kind === "month") {
      const scale = scaleOf(p.days.map((x) => x.minutes));
      const n = p.days.length;
      const bars = p.days.map((x) => {
        const h = x.minutes ? (x.minutes / scale) * 100 : 0;
        const tip = `${pad2(p.month)}/${pad2(x.day)} ${x.minutes ? fmtHM(x.minutes) : (x.sabori ? "さぼり券" : "―")}`;
        return `<div class="st-daybar${x.is_today ? " today" : ""}" title="${tip}"><div class="st-daybar-fill" style="height:${h}%"></div>${x.sabori ? '<span class="st-ticket">🎟</span>' : ""}</div>`;
      }).join("");
      const labelDays = [1];
      for (let v = 5; v <= n; v += 5) labelDays.push(v);
      const labels = labelDays.map((v) => `<span style="left:${((v - 0.5) / n) * 100}%">${v}</span>`).join("");
      // この月に重なる連続記録を、すべて帯で示す(いま進行中のものは朱色、過去のものは薄いインク色)
      const seg = (p.streak_spans || [])
        .map((sp) => `<div class="st-seg${sp.current ? "" : " past"}" title="${sp.days}日連続" style="left:${((sp.from - 1) / n) * 100}%; width:${((sp.to - sp.from + 1) / n) * 100}%"></div>`)
        .join("");
      html = `
        <div class="sect-lbl">日別学習時間・${p.month}月</div>
        <div class="st-streak">${streakLineHtml(d.streak, todayY)}</div>
        ${pastStreakHtml(d.streak, todayY)}
        <div class="st-daychart">${bars}</div>
        <div class="st-daylabels">${labels}</div>
        <div class="st-streak-track">${seg}</div>`;
    } else {
      const scale = scaleOf(p.months.map((m) => m.minutes));
      const spansYears = new Set(p.months.map((m) => m.year)).size > 1;
      const bars = p.months.map((m) =>
        `<div class="st-mbar${m.is_current ? " cur" : ""}" title="${m.year}/${pad2(m.month)} ${fmtHM(m.minutes)}"><div class="st-mbar-fill" style="height:${m.minutes ? (m.minutes / scale) * 100 : 0}%"></div></div>`
      ).join("");
      const labels = p.months.map((m) => `<span>${spansYears ? `${String(m.year).slice(2)}/${pad2(m.month)}` : `${m.month}月`}</span>`).join("");
      const b = p.best_streak;
      const best = b
        ? `<div class="st-best-v mono">${b.days}日<span> ・ ${fmtDate(b.start, todayY)}-${fmtDate(b.end, todayY)}</span></div>`
        : `<div class="st-best-t">まだ連続記録はありません</div>`;
      html = `
        <div class="sect-lbl">月別学習時間${p.truncated ? "・直近12か月" : ""}</div>
        <div class="st-month-chart">${bars}</div>
        <div class="st-month-labels">${labels}</div>
        <div class="st-best"><div class="st-best-t">最長連続記録(自己ベスト)</div>${best}</div>`;
    }
    $("#stPanel").innerHTML = html;
  }

  function paintWeekday(d) {
    const el = $("#stWeekday");
    if (!d.weekday_avg) { el.style.display = "none"; return; } // 今週は曜日別を出さない
    el.style.display = "";
    const max = Math.max(...d.weekday_avg.map((w) => w.avg_min));
    const scale = scaleOf(d.weekday_avg.map((w) => w.avg_min));
    el.innerHTML = `<div class="sect-lbl">曜日別・平均学習時間</div>` + d.weekday_avg.map((w) => {
      const top = max > 0 && w.avg_min === max;
      return `<div class="st-wd-row">
        <div class="st-wd-lbl">${w.weekday}</div>
        <div class="st-wd-track"><div class="st-wd-fill" style="width:${w.avg_min ? (w.avg_min / scale) * 100 : 0}%${top ? "; background:var(--stamp)" : ""}"></div></div>
        <div class="st-wd-val mono">${fmtHM(w.avg_min)}</div>
      </div>`;
    }).join("");
  }

  function paintTags(d) {
    const t = d.tags_breakdown;
    const body = t.length
      ? `<div class="st-tagbar">${t.map((x) => `<span style="width:${x.ratio * 100}%; background:${x.color}"></span>`).join("")}</div>
         <div class="st-tag-legend">${t.map((x) => `<div class="st-tag-item"><span class="st-tag-sw" style="background:${x.color}"></span><b>${esc(x.name)}</b> ${x.pct}% ・ ${fmtHM(x.minutes)}</div>`).join("")}</div>`
      : `<div class="empty-note">この期間のタグ付きの記録はありません</div>`;
    $("#stTags").innerHTML = `<div class="sect-lbl">タグ別・内訳</div>${body}`;
  }

  function paintQuality(d) {
    const q = d.quality_dist;
    const maxC = Math.max(...q.map((x) => x.count));
    const body = maxC > 0
      ? q.map((x) => `<div class="st-q-row">
          <div class="st-q-lbl">★${x.star}</div>
          <div class="st-q-track"><div class="st-q-fill" style="width:${(x.count / maxC) * 100}%"></div></div>
          <div class="st-q-val mono">${x.count}件</div>
        </div>`).join("")
      : `<div class="empty-note">この期間の記録はありません</div>`;
    $("#stQuality").innerHTML = `<div class="sect-lbl">充実度・分布</div>${body}`;
  }

  // ── 詳細統計ポップアップ ──
  function ratioBlock(label, items, legendOf, colorOf, note) {
    const bar = items.map((x) => `<span style="width:${x.ratio * 100}%; background:${colorOf(x.key)}"></span>`).join("");
    const legend = items.map((x) => `<span><span class="st-sw" style="background:${colorOf(x.key)}"></span>${legendOf(x.key)} ${x.pct}%</span>`).join("");
    return `<div class="st-ratio"><div class="st-ratio-l">${label}</div><div class="st-ratio-bar">${bar}</div><div class="st-ratio-legend">${legend}</div>${note ? `<div class="st-ratio-note">${note}</div>` : ""}</div>`;
  }

  function openDetail() {
    const d = data;
    if (!d) return;
    const x = d.detail;
    const todayY = new Date().getFullYear();
    overlay.querySelector("#stDetailTitle").textContent = `詳細統計・${PERIOD_TITLE[d.period]}`;

    let html;
    if (d.overview.count === 0) {
      html = `<div class="empty-note">この期間の記録はありません</div>`;
    } else {
      const row = (lbl, val) => `<div class="st-drow"><span class="st-dlbl">${lbl}</span><span class="st-dval mono">${val}</span></div>`;
      html = row("最大記録時間(1日)", x.max_day ? `${fmtHM(x.max_day.minutes)} <span class="st-dsub">(${fmtDate(x.max_day.date, todayY)})</span>` : "―")
        + row("平均記録時間(1日)", x.avg_day_min == null ? "―" : fmtHM(x.avg_day_min))
        + row("1記録あたりの平均時間", x.avg_per_record_min == null ? "―" : fmtHM(x.avg_per_record_min))
        + row("1日あたりの平均記録数", x.records_per_day == null ? "―" : `${x.records_per_day.toFixed(1)}件`);

      const ts = x.time_slots;
      const slotTotal = ts.items.reduce((s, i) => s + i.minutes, 0);
      html += slotTotal > 0
        ? ratioBlock("時間帯の比率(午前/午後/夜)", ts.items, (k) => SLOT_LABEL[k], (k) => `rgba(var(--ink-rgb),${SLOT_ALPHA[k]})`,
            `開始時刻のある記録 ${ts.timed_records}/${ts.total_records}件が対象(ストップウォッチ記録のみ)`)
        : `<div class="st-ratio"><div class="st-ratio-l">時間帯の比率(午前/午後/夜)</div><div class="st-ratio-note">まだデータがありません。開始時刻はストップウォッチの記録から貯まります</div></div>`;

      html += ratioBlock("平日/土日の比率", x.weekday_split, (k) => (k === "weekday" ? "平日" : "土日"),
        (k) => (k === "weekday" ? "rgba(var(--ink-rgb),0.55)" : "var(--gold)"));
      html += ratioBlock("記録方法の比率(ストップウォッチ/手動入力)", x.source_split,
        (k) => (k === "stopwatch" ? "⏱ ストップウォッチ" : "✏️ 手動入力"),
        (k) => (k === "stopwatch" ? "rgba(var(--ink-rgb),0.82)" : "rgba(var(--ink-rgb),0.30)"));
    }
    overlay.querySelector("#stDetailBody").innerHTML = html;
    overlay.classList.add("open");
  }

  // ── イベント ──
  $("#stPeriod").addEventListener("click", (e) => {
    const btn = e.target.closest(".tbtn[data-p]");
    if (btn && btn.dataset.p !== period) load(btn.dataset.p, { animate: true }); // 同じ期間をもう一度押しても、何も起きない
  });
  $("#stDetailBtn").addEventListener("click", openDetail);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.dataset.act === "close") overlay.classList.remove("open");
  });

  await load(period);
}
