// Study Tracker v3 - 試験管理タブ

import { mountPoints } from "../components/points.js";
import { attachDateSteppers } from "../components/dateStepper.js";
import { growIn, shrinkOut, finished } from "../components/motion.js";
import { showConfirm } from "../components/dialog.js";
import { createFormError } from "../components/formError.js";
import { validateExamForm } from "../components/validate.js";

export function onLeave() {}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function daysBetween(aIso, bIso) {
  const a = new Date(aIso + "T00:00:00"), b = new Date(bIso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
// 今年と同じなら月/日のみ、違う年なら YYYY/MM/DD
function fmtDate(iso, todayY) {
  const [y, m, d] = iso.split("-");
  return y === String(todayY) ? `${m}/${d}` : `${y}/${m}/${d}`;
}
function fmtHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export async function render(root, api) {
  root.innerHTML = `
    <div class="top"><h1>試験管理</h1><div class="right"><span class="pts mono" id="ptsTop">…</span></div></div>
    <button class="add-btn" id="examAddBtn">＋ 試験を追加</button>
    <div class="sect-lbl" style="margin:20px 4px 10px;">今後の試験</div>
    <div id="upcomingList"></div>
    <div class="sect-lbl" style="margin:20px 4px 10px;">過去の試験</div>
    <div id="pastList"></div>

    <div class="modal-overlay" id="examOverlay">
      <div class="modal-box">
        <button class="modal-close" data-act="close">✕</button>
        <div class="modal-title" id="examModalTitle">試験を追加</div>
        <div class="field"><div class="flbl">試験名</div><input class="finput wide" id="examName" placeholder="例: 期末試験"></div>
        <div class="field"><div class="flbl">日付</div>
          <div class="date-row">
            <input class="finput y mono" id="examY"><span>年</span>
            <input class="finput mono" id="examM"><span>月</span>
            <input class="finput mono" id="examD"><span>日</span>
          </div>
        </div>
        <div class="field"><div class="flbl">目標勉強時間</div>
          <div class="date-row"><input class="finput mono" id="examGoalHours" value="25" style="width:60px;"><span>時間</span></div>
        </div>
        <div class="form-err" id="examErr" hidden></div>
        <div class="modal-actions">
          <button class="btn muted" data-act="close">キャンセル</button>
          <button class="btn primary" id="examSaveBtn">保存する</button>
        </div>
      </div>
    </div>
  `;

  const home = await api.get_home_data();
  mountPoints(root.querySelector("#ptsTop"), home.points_balance);
  attachDateSteppers(root.querySelector("#examY"), root.querySelector("#examM"), root.querySelector("#examD"));
  // 追加・編集で同じポップアップを使うので、エラー表示も共通(必須: 試験名・正しい日付・0より大きい目標時間。エラー時だけ朱色になる)
  const examFields = {
    name: root.querySelector("#examName"), y: root.querySelector("#examY"), m: root.querySelector("#examM"),
    d: root.querySelector("#examD"), goal: root.querySelector("#examGoalHours"),
  };
  const examErr = createFormError(root.querySelector("#examErr"));
  examErr.watch(Object.values(examFields));

  root.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.dataset.act === "close") ov.classList.remove("open"); });
  });

  let exams = [];
  async function reload() {
    exams = await api.get_exams();
    paint();
  }

  function paint() {
    const today = todayIso();
    const todayY = new Date().getFullYear();
    const upcoming = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date));
    const past = exams.filter((e) => e.date < today).sort((a, b) => b.date.localeCompare(a.date));

    const upcomingEl = root.querySelector("#upcomingList");
    upcomingEl.innerHTML = upcoming.length
      ? upcoming.map((e) => upcomingCardHtml(e, today, todayY)).join("")
      : `<div class="empty-note">今後の試験はまだ登録されていません</div>`;

    const pastEl = root.querySelector("#pastList");
    pastEl.innerHTML = past.length
      ? past.map((e) => pastRowHtml(e, todayY)).join("")
      : `<div class="empty-note">過去の試験はありません</div>`;

    root.querySelectorAll("[data-edit-exam]").forEach((b) => b.addEventListener("click", () => openEdit(parseInt(b.dataset.editExam, 10))));
    root.querySelectorAll("[data-del-exam]").forEach((b) => b.addEventListener("click", () => askDelete(parseInt(b.dataset.delExam, 10))));
  }

  function upcomingCardHtml(e, today, todayY) {
    const daysLeft = daysBetween(today, e.date);
    let elapsedPct = 0;
    if (e.created_date) {
      const span = daysBetween(e.created_date, e.date);
      const passed = daysBetween(e.created_date, today);
      elapsedPct = span > 0 ? Math.min(Math.max(passed / span, 0), 1) * 100 : 100;
    }
    const progressPct = e.progress_pct || 0;
    const isDone = progressPct >= 100;
    const isUrgent = !isDone && daysLeft <= 1;

    const headExtra = isUrgent
      ? `<span class="badge-tomorrow">${daysLeft === 0 ? "今日" : "明日"}</span>`
      : isDone
      ? `<span class="badge-done">★ 目標達成</span>`
      : "";
    const cdHtml = `<span class="cd mono">${daysLeft === 0 ? "本日" : `あと${daysLeft}日`}</span>`;

    const gauges = isDone
      ? doneGaugesHtml(progressPct, elapsedPct, e.done_min, e.goal_minutes)
      : normalGaugesHtml(progressPct, elapsedPct, e.done_min, e.goal_minutes);

    return `
      <div class="exam-card${isUrgent ? " urgent" : ""}${isDone ? " done" : ""}" data-exam-id="${e.id}">
        <div class="exam-head">
          <div>${headExtra}<span class="name">${esc(e.name)}</span><span class="date">${fmtDate(e.date, todayY)}</span></div>
          <div class="exam-actions">
            ${cdHtml}
            <button class="icon-btn" data-edit-exam="${e.id}">✎</button>
            <button class="icon-btn del" data-del-exam="${e.id}">✕</button>
          </div>
        </div>
        ${gauges}
      </div>`;
  }

  function normalGaugesHtml(progressPct, elapsedPct, doneMin, goalMin) {
    const behind = elapsedPct > progressPct;
    const diff = Math.round(Math.abs(elapsedPct - progressPct));
    const verdict = diff === 0
      ? "学習進捗と期間消化は同じ水準です"
      : behind
      ? `期間消化が学習進捗を <b>${diff}pt</b> 上回っています`
      : `学習進捗が期間消化を <b>+${diff}pt</b> 上回っています`;
    return `
      <div class="meter-row"><div class="lbl">学習進捗</div><div class="meter-track"><div class="meter-fill" style="width:${Math.round(progressPct)}%"></div></div><div class="val mono">${Math.round(progressPct)}%</div></div>
      <div class="meter-row"><div class="lbl">期間消化</div><div class="meter-track"><div class="meter-fill" style="width:${Math.round(elapsedPct)}%; background:var(--stamp);"></div></div><div class="val mono">${Math.round(elapsedPct)}%</div></div>
      <div class="exam-foot${behind ? " warn" : ""}"><div>${verdict}</div><div class="mono">${fmtHM(doneMin)} / ${fmtHM(goalMin)}</div></div>`;
  }

  function doneGaugesHtml(progressPct, elapsedPct, doneMin, goalMin) {
    const scaleMax = Math.max(progressPct, 100);
    const tickPos = (100 / scaleMax) * 100;
    const progWidth = Math.min(tickPos, (progressPct / scaleMax) * 100);
    const overWidth = Math.max(0, (progressPct / scaleMax) * 100 - tickPos);
    const elapsedWidth = (elapsedPct / scaleMax) * 100;
    return `
      <div class="meter-row"><div class="lbl">学習進捗</div>
        <div class="meter-track overshoot"><div class="meter-fill" style="width:${progWidth}%"></div><div class="meter-over" style="width:${overWidth}%"></div><span class="meter-tick lbl" style="left:${tickPos}%"></span></div>
        <div class="val mono"><b class="over">${Math.round(progressPct)}%</b></div></div>
      <div class="meter-row"><div class="lbl">期間消化</div>
        <div class="meter-track overshoot"><div class="meter-fill" style="width:${elapsedWidth}%; background:var(--stamp);"></div><span class="meter-tick" style="left:${tickPos}%"></span></div>
        <div class="val mono">${Math.round(elapsedPct)}%</div></div>
      <div class="exam-foot"><div>目標を達成済みです</div><div class="mono">${fmtHM(doneMin)} / ${fmtHM(goalMin)}</div></div>`;
  }

  function pastRowHtml(e, todayY) {
    const achieved = (e.progress_pct || 0) >= 100;
    return `
      <div class="past-exam">
        <div class="pe-top">
          <div><span class="name">${esc(e.name)}</span><span class="date">${fmtDate(e.date, todayY)}</span></div>
          <div class="result-col">
            <div class="result ${achieved ? "ok" : "ng"}">${achieved ? "✓ 達成" : "未達"} (${Math.round(e.progress_pct)}%)</div>
            <div class="pe-hours mono">${fmtHM(e.done_min)} / ${fmtHM(e.goal_minutes)}</div>
          </div>
        </div>
      </div>`;
  }

  // ── 追加/編集 ──
  let editingExam = null;
  function openAdd() {
    editingExam = null;
    root.querySelector("#examModalTitle").textContent = "試験を追加";
    root.querySelector("#examName").value = "";
    const t = new Date();
    root.querySelector("#examY").value = t.getFullYear();
    root.querySelector("#examM").value = String(t.getMonth() + 1).padStart(2, "0");
    root.querySelector("#examD").value = String(t.getDate()).padStart(2, "0");
    root.querySelector("#examGoalHours").value = 25;
    examErr.reset();
    root.querySelector("#examOverlay").classList.add("open");
  }
  function openEdit(id) {
    const e = exams.find((x) => x.id === id);
    if (!e) return;
    editingExam = e;
    root.querySelector("#examModalTitle").textContent = "試験を編集";
    root.querySelector("#examName").value = e.name;
    const [y, m, d] = e.date.split("-");
    root.querySelector("#examY").value = y;
    root.querySelector("#examM").value = m;
    root.querySelector("#examD").value = d;
    root.querySelector("#examGoalHours").value = (e.goal_minutes / 60).toFixed(1);
    examErr.reset();
    root.querySelector("#examOverlay").classList.add("open");
  }
  root.querySelector("#examAddBtn").addEventListener("click", openAdd);
  root.querySelector("#examSaveBtn").addEventListener("click", async () => {
    const v = validateExamForm({
      name: examFields.name.value, y: examFields.y.value, m: examFields.m.value, d: examFields.d.value,
      goalHours: examFields.goal.value,
    });
    if (!v.ok) {
      if (v.field.startsWith("date-")) {
        // 日付の3つの入力欄を朱色にして、問題のある欄へフォーカスする
        examErr.show(v.message, { fields: [examFields.y, examFields.m, examFields.d], focus: examFields[v.field.slice(5)] });
      } else {
        examErr.show(v.message, { fields: [examFields[v.field]] });
      }
      return;
    }
    let added = null;
    if (editingExam) await api.update_exam(editingExam.id, v.name, v.dateStr, v.goalMinutes);
    else added = await api.add_exam(v.name, v.dateStr, v.goalMinutes);
    root.querySelector("#examOverlay").classList.remove("open");
    await reload();
    // 追加したカードを、周りを押しのけながら拡大・フェードインで出す(編集のときは出さない)
    if (added && added.id != null) growIn(root.querySelector(`.exam-card[data-exam-id="${added.id}"]`));
  });

  // ── 削除(ダイアログは components/dialog.js に統一。danger なので、最初のフォーカスと Enter はキャンセル) ──
  let deleting = false;
  async function askDelete(id) {
    const e = exams.find((x) => x.id === id);
    if (!e || deleting) return;
    deleting = true;
    try {
      const ok = await showConfirm(`「${e.name}」(${e.date}) を削除しますか？`, { title: "試験の削除", okText: "削除する", danger: true });
      if (!ok) return;
      // 縮小・フェードアウトしながら消え、後ろのカードが滑らかに上がってくる(API の完了も待ってから描き直す)
      const exit = shrinkOut(root.querySelector(`.exam-card[data-exam-id="${id}"]`));
      await Promise.all([api.delete_exam(id), finished(exit)]);
      await reload();
    } finally { deleting = false; }
  }

  await reload();
}
