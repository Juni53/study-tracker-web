// Study Tracker v3 - ホームタブ
import { renderSmoothChart } from "../components/chart.js";
import { navigate } from "../app.js";
import { mountPoints } from "../components/points.js";
import { homeMessage } from "../components/homeMessage.js";

let chartResizeObserver = null;

export function onLeave() {
  if (chartResizeObserver) {
    chartResizeObserver.disconnect();
    chartResizeObserver = null;
  }
}

const TAG_COLOR = (id, tags) => (tags.find((t) => t.id === id) || {}).color || "var(--ink-sub)";
const TAG_NAME  = (id, tags) => (tags.find((t) => t.id === id) || {}).name || "";

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function fmtHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

export async function render(root, api) {
  root.innerHTML = `<div class="top"><h1>ホーム</h1><div class="right"><span class="mono" id="todayDate"></span><span class="pts mono">…</span></div></div>`;
  let data = null;
  try {
    data = await api.get_home_data();
  } catch (e) {
    console.error(e);
  }
  if (!data) {
    root.insertAdjacentHTML("beforeend", `<p style="color:var(--ink-sub); padding:20px 4px;">データを取得できませんでした(API エラー。ページを再読み込みしても直らない場合は、お知らせください)。</p>`);
    return;
  }
  paint(root, data);
}

function paint(root, d) {
  const today = new Date();
  const wd = "日月火水木金土"[today.getDay()];
  root.querySelector("#todayDate").textContent =
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")} (${wd})`;
  mountPoints(root.querySelector(".pts"), d.points_balance);

  const nextBonus = d.next_bonus_days != null ? `次のボーナス ${d.next_bonus_days}日` : "";
  const streakStatusLabel = { active: "継続中", warning: "今日中に記録を", danger: "途切れています" }[d.streak_state] || "";

  root.insertAdjacentHTML(
    "beforeend",
    `
    <div class="grid-top">
      <div class="streak-box">
        <div class="lbl2">連続記録</div>
        <div class="num mono">${String(d.streak).padStart(2, "0")}<span> 日</span></div>
        <div class="status ${d.streak_state}"><span class="dot ${d.streak_state === "active" ? "live" : ""}"></span><span class="st-text"><span class="st-a">${streakStatusLabel}</span>${nextBonus ? `<span class="st-sep"> ・ </span><span class="st-b">${nextBonus}</span>` : ""}</span></div>
      </div>
      <div class="home-meters">
        ${goalMeterRowHtml("今日", d.today_min, d.daily_goal_min)}
        ${goalMeterRowHtml("今月", d.month_min, d.month_goal_min)}
      </div>
    </div>

    ${examCardHtml(d.nearest_exam)}

    <div class="chart-sec">
      <div class="sect-lbl">週間推移</div>
      <div class="chart-wrap" id="weekChart"></div>
      <div class="chart-days">${d.week.map((w) => `<span>${w.weekday}</span>`).join("")}</div>
    </div>

    <div class="log">
      <div class="lg-head"><div>日付</div><div>時間配分</div><div style="text-align:right;padding-right:8px;">時間</div><div class="tg-head" style="padding-left:10px;">タグ</div></div>
      ${weekRowsHtml(d.week, d.tags)}
    </div>

    <div class="split">
      <div>
        <div class="sect-lbl">タグ別・全期間</div>
        ${tagBreakdownHtml(d.tags_breakdown)}
      </div>
      <div>
        <div class="sect-lbl">ポイント履歴・直近</div>
        <div class="hist">${historyHtml(d.points_history)}</div>
      </div>
    </div>
    <div class="note">${esc(homeMessage(d))}</div>
  `
  );

  const shortcutBtn = root.querySelector("#examShortcutBtn");
  if (shortcutBtn) shortcutBtn.addEventListener("click", () => navigate("exam"));

  const chartEl = root.querySelector("#weekChart");
  const todayIndex = d.week.findIndex((w) => w.is_today);
  const weekValues = d.week.map((w) => w.minutes);
  const opts = { todayIndex: todayIndex >= 0 ? todayIndex : d.week.length - 1 };
  renderSmoothChart(chartEl, weekValues, opts);

  // コンテナの幅が変わるたび(サイドバー折りたたみ・ウィンドウのリサイズ)に描き直し、
  // 曲線と「今日」のドットの位置がずれないようにする。
  if (chartResizeObserver) chartResizeObserver.disconnect();
  chartResizeObserver = new ResizeObserver(() => renderSmoothChart(chartEl, weekValues, opts));
  chartResizeObserver.observe(chartEl);
}

function pct(v, goal) {
  if (!goal) return 0;
  return Math.min(100, Math.round((v / goal) * 100));
}

// 今日/今月の目標ゲージ。目標を超えたら、試験の達成カードと同じ「100%に目盛り+超過分は金色」の表示にする。
function goalMeterRowHtml(label, doneMin, goalMin) {
  const ratio = goalMin ? doneMin / goalMin : 0;
  if (ratio <= 1) {
    return `<div class="meter-row"><div class="lbl">${label}</div>
      <div class="meter-track"><div class="meter-fill" style="width:${Math.round(ratio * 100)}%"></div></div>
      <div class="val mono"><b>${fmtHM(doneMin)}</b> / ${fmtHM(goalMin)}</div></div>`;
  }
  const totalPct = ratio * 100;
  const tickPos = (100 / totalPct) * 100; // 100%地点が、全体(totalPct%分)の中でどこに来るか
  // 超過時は、実勉強時間(done)だけ金色にし、目標時間(goal)側は通常色のまま
  return `<div class="meter-row"><div class="lbl">${label}</div>
    <div class="meter-track overshoot">
      <div class="meter-fill" style="width:${tickPos}%"></div>
      <div class="meter-over" style="width:${100 - tickPos}%"></div>
      <span class="meter-tick" style="left:${tickPos}%"></span>
    </div>
    <div class="val mono"><b class="over">${fmtHM(doneMin)}</b> / ${fmtHM(goalMin)}</div></div>`;
}

function examCardHtml(exam) {
  if (!exam) {
    return `<div class="exam-card"><div class="sect-lbl" style="margin:0;">今後の試験</div><div class="empty-note">登録されている試験はありません。試験管理タブから追加できます。</div></div>`;
  }
  const isDone = exam.progress_pct >= 100;
  const isUrgent = !isDone && exam.days_left <= 1; // 試験管理タブと同じ判定(目標未達成で、明日か今日)
  const sameDayNote = exam.same_day_extra > 0
    ? `<div class="exam-sameday">📌 同じ日にほか${exam.same_day_extra}件の試験があります <button class="exam-sameday-btn" id="examShortcutBtn">試験管理で見る →</button></div>`
    : "";

  let gauges;
  if (isDone) {
    // 派手にしすぎない程度に: 薄い金の枠だけ付け、ゲージは超過分を金色で見せる
    const scaleMax = Math.max(exam.progress_pct, 100);
    const tickPos = (100 / scaleMax) * 100;
    const progWidth = Math.min(tickPos, (exam.progress_pct / scaleMax) * 100);
    const overWidth = Math.max(0, (exam.progress_pct / scaleMax) * 100 - tickPos);
    const elapsedWidth = (exam.elapsed_pct / scaleMax) * 100;
    gauges = `
      <div class="meter-row"><div class="lbl">学習進捗</div>
        <div class="meter-track overshoot"><div class="meter-fill" style="width:${progWidth}%"></div><div class="meter-over" style="width:${overWidth}%"></div><span class="meter-tick" style="left:${tickPos}%"></span></div>
        <div class="val mono"><b class="over">${exam.progress_pct}%</b></div></div>
      <div class="meter-row"><div class="lbl">期間消化</div>
        <div class="meter-track overshoot"><div class="meter-fill" style="width:${elapsedWidth}%; background:var(--stamp);"></div><span class="meter-tick" style="left:${tickPos}%"></span></div>
        <div class="val mono">${exam.elapsed_pct}%</div></div>
      <div class="exam-foot"><div>目標を達成済みです</div><div class="mono">${fmtHM(exam.done_min)} / ${fmtHM(exam.goal_min)}</div></div>`;
  } else {
    const behind = exam.elapsed_pct > exam.progress_pct;
    const diff = Math.abs(exam.elapsed_pct - exam.progress_pct);
    const verdict = diff === 0
      ? "学習進捗と期間消化は同じ水準です"
      : behind
      ? `期間消化が学習進捗を <b>${diff}pt</b> 上回っています`
      : `学習進捗が期間消化を <b>+${diff}pt</b> 上回っています`;
    gauges = `
      <div class="meter-row"><div class="lbl">学習進捗</div><div class="meter-track"><div class="meter-fill" style="width:${exam.progress_pct}%"></div></div><div class="val mono">${exam.progress_pct}%</div></div>
      <div class="meter-row"><div class="lbl">期間消化</div><div class="meter-track"><div class="meter-fill" style="width:${exam.elapsed_pct}%; background:var(--stamp);"></div></div><div class="val mono">${exam.elapsed_pct}%</div></div>
      <div class="exam-foot${behind ? " warn" : ""}"><div>${verdict}</div><div class="mono">${fmtHM(exam.done_min)} / ${fmtHM(exam.goal_min)}</div></div>`;
  }

  return `
    <div class="exam-card${isDone ? " done-quiet" : ""}">
      <div class="exam-head"><div>${isDone ? '<span class="badge-done-quiet">★ 達成</span>' : isUrgent ? `<span class="badge-tomorrow">${exam.days_left <= 0 ? "今日" : "明日"}</span>` : ""}<span class="name">${esc(exam.name)}</span><span class="date">${exam.date.slice(5).replace("-", "/")}</span></div><div class="cd mono">あと ${exam.days_left}日</div></div>
      ${gauges}
      ${sameDayNote}
    </div>`;
}

function weekRowsHtml(week, tags) {
  const max = Math.max(...week.map((w) => w.minutes), 1);
  return week
    .map((w) => {
      const [, mm, dd] = w.date.split("-");
      const pctW = (w.minutes / (max * 1.15)) * 100;
      const tagDots = w.tag_ids.map((id) => `<i style="background:${TAG_COLOR(id, tags)}"></i>`).join("");
      return `<div class="lg-row${w.is_today ? " today" : ""}">
        <div class="d mono"><b>${mm}/${dd}</b><span>${w.weekday}</span></div>
        <div><div class="bt"><div class="bf" style="width:${w.minutes ? pctW : 0}%"></div></div></div>
        <div class="m mono">${w.minutes ? fmtHM(w.minutes) : "―"}</div>
        <div class="tg">${tagDots}</div>
      </div>`;
    })
    .join("");
}

function tagBreakdownHtml(breakdown) {
  if (!breakdown.length) return `<div class="empty-note">まだ記録がありません</div>`;
  const bar = breakdown.map((t) => `<span style="width:${t.pct}%; background:${t.color}"></span>`).join("");
  const legend = breakdown
    .map((t) => `<span><i style="background:${t.color}"></i>${t.name} ${t.pct}%</span>`)
    .join("");
  return `<div class="tagbar">${bar}</div><div class="legend">${legend}</div>`;
}

function historyHtml(history) {
  if (!history.length) return `<div class="empty-note">履歴はまだありません</div>`;
  return history
    .map((h) => `<div class="hrow"><span class="r">${h.reason}</span><span class="d mono">${h.delta >= 0 ? "+" : ""}${h.delta.toFixed(1)}</span></div>`)
    .join("");
}
