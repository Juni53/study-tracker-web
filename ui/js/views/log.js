// Study Tracker v3 - 記録ログタブ(手動入力を統合)
import { openSaveForm } from "../components/saveForm.js";
import { tagChipsHtml, examChipsHtml, bindChipToggle, selectedChipIds, chipLabel } from "../components/pickers.js";
import { mountPoints } from "../components/points.js";
import { refreshPoints } from "../components/points.js";
import { showConfirm } from "../components/dialog.js";
import { createFormError } from "../components/formError.js";
import { staggerIn, visibleBlocks, growIn, shrinkOut, finished } from "../components/motion.js";

function fmtHM(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}
function weekdayOf(dateStr) {
  return "日月火水木金土"[new Date(dateStr + "T00:00:00").getDay()];
}
function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let state = { sort: "desc", activeTags: new Set() };

export function onLeave() {}

export async function render(root, api) {
  root.innerHTML = `
    <div class="top"><h1>記録ログ</h1><div class="right"><span class="pts mono" id="ptsTop">…</span></div></div>
    <button class="add-btn" id="manualAddBtn">＋ 手動で追加</button>

    <div class="lock-note">タイトルはいつでも編集できます。タグ・試験の紐づけは、記録した当日のみ編集できます</div>

    <div class="sortbar" id="sortRow">
      <span>並び替え:</span>
      <button class="tbtn active" data-sort="desc" data-text="新しい順">新しい順</button>
      <button class="tbtn" data-sort="asc" data-text="古い順">古い順</button>
    </div>
    <div class="chips" id="filterChips" style="margin-bottom:10px;"></div>

    <div id="logList"></div>

    <div class="modal-overlay" id="editOverlay">
      <div class="modal-box">
        <button class="modal-close" data-act="close">✕</button>
        <div class="modal-title">記録を編集</div>
        <div class="edit-summary" id="editSummary"></div>
        <div class="field"><div class="flbl">タイトル(任意)</div><input class="finput wide" id="editTitle" placeholder="タイトルなし"></div>
        <div class="field"><div class="flbl" id="editTagLbl">タグ</div><div class="chips" id="editTagChips"></div></div>
        <div class="field"><div class="flbl" id="editExamLbl">関連する試験(複数選択可)</div><div class="chips" id="editExamChips"></div></div>
        <div class="lock-hint" id="editLockHint" style="display:none;">🔒 日付が変わったため、タグ・試験の紐づけは変更できません</div>
        <div class="form-err" id="editErr" hidden></div>
        <div class="modal-actions">
          <button class="btn muted" data-act="close">キャンセル</button>
          <button class="btn primary" id="editSaveBtn">保存する</button>
        </div>
      </div>
    </div>
  `;

  const [home, tags, exams] = await Promise.all([api.get_home_data(), api.get_tags(), api.get_exams()]);
  mountPoints(root.querySelector("#ptsTop"), home.points_balance);

  root.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.dataset.act === "close") ov.classList.remove("open");
    });
  });

  root.querySelector("#manualAddBtn").addEventListener("click", () => {
    openSaveForm(api, {
      source: "manual",
      onSaved: async (rec) => {
        await reload();
        // 追加した記録を、周りを押しのけながら拡大・フェードインで出す。
        // その日の最初の記録なら、日付の見出しごと(日のグループ全体)を出す。絞り込みで見えない場合は何もしない
        const row = root.querySelector(`.rec[data-rec-id="${rec.id}"]`);
        if (!row) return;
        const group = row.closest(".day-group");
        growIn(group && group.querySelectorAll(".rec").length === 1 ? group : row);
      },
    });
  });

  root.querySelectorAll("#sortRow .tbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.sort === btn.dataset.sort) return; // 同じ並び順をもう一度押しても、何も起きない
      state.sort = btn.dataset.sort;
      root.querySelectorAll("#sortRow .tbtn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      paintList({ animate: true });
    });
  });

  const filterEl = root.querySelector("#filterChips");
  filterEl.innerHTML = tags
    .map((t) => `<div class="chip" data-tag="${t.id}"><span class="sw" style="background:${t.color}"></span>${chipLabel(t.name)}</div>`)
    .join("") + `<div class="chip" data-clear="1" style="border-style:dashed;">✕ 解除</div>`;
  filterEl.addEventListener("click", (e) => {
    const clear = e.target.closest("[data-clear]");
    if (clear) {
      if (!state.activeTags.size) return; // 絞り込みが無いときに解除を押しても、何も起きない
      state.activeTags.clear();
      filterEl.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      paintList({ animate: true });
      return;
    }
    const chip = e.target.closest(".chip[data-tag]");
    if (!chip) return;
    const id = parseInt(chip.dataset.tag, 10);
    chip.classList.toggle("active");
    if (state.activeTags.has(id)) state.activeTags.delete(id); else state.activeTags.add(id);
    paintList({ animate: true });
  });

  let records = [];
  async function reload() {
    records = await api.get_records();
    paintList();
  }

  function tagById(id) { return tags.find((t) => t.id === id); }
  function examById(id) { return exams.find((e) => e.id === id); }

  // animate: 並び替え・絞り込みを変えたときだけ true。一覧を上から順にフェードイン+スライドで出し直す
  // (追加・編集・削除のあとの再描画では出し直さない)
  function paintList({ animate = false } = {}) {
    const listEl = root.querySelector("#logList");
    const replay = () => { if (animate) staggerIn(visibleBlocks(listEl)); };
    let filtered = records;
    if (state.activeTags.size) {
      filtered = records.filter((r) => (r.tag_ids || []).some((id) => state.activeTags.has(id)));
    }
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-note">記録がありません</div>`;
      replay();
      return;
    }
    const byDate = {};
    filtered.forEach((r) => { (byDate[r.date] = byDate[r.date] || []).push(r); });
    let dates = Object.keys(byDate).sort();
    if (state.sort === "desc") dates.reverse();

    listEl.innerHTML = dates
      .map((date) => {
        const recs = byDate[date];
        const totalMin = recs.reduce((s, r) => s + r.minutes, 0);
        const totalPts = recs.reduce((s, r) => s + r.points_earned, 0);
        const [, mm, dd] = date.split("-");
        return `
          <div class="day-group">
            <div class="day-head"><span class="d mono"><b>${mm}/${dd}</b> ${weekdayOf(date)}</span><span class="total mono">合計 ${fmtHM(totalMin)} ・ ${totalPts.toFixed(1)}P</span></div>
            ${recs.map((r) => recRowHtml(r, date === todayIso())).join("")}
          </div>`;
      })
      .join("");

    listEl.querySelectorAll("[data-edit]").forEach((btn) => btn.addEventListener("click", () => openEdit(parseInt(btn.dataset.edit, 10))));
    listEl.querySelectorAll("[data-del]").forEach((btn) => btn.addEventListener("click", () => askDelete(parseInt(btn.dataset.del, 10))));
    replay();
  }

  function recRowHtml(r, isToday) {
    const src = r.source === "stopwatch" ? "⏱" : "✏️";
    const stars = r.quality ? "★".repeat(r.quality) + "☆".repeat(5 - r.quality) : "-";
    const tagSpans = (r.tag_ids || []).map((id) => { const t = tagById(id); return t ? `<span class="rec-tagx"><span class="sw" style="background:${t.color}"></span>${t.name}</span>` : ""; }).join("");
    const examSpans = (r.exam_ids || []).map((id) => { const e = examById(id); return e ? `<span class="rec-tagx exam"><span class="ex-flag">⚑</span>${e.name}</span>` : ""; }).join("");
    return `
      <div class="rec" data-rec-id="${r.id}">
        <div class="rec-top">
          <div class="rec-src">${src}</div>
          <div class="rec-dur mono">${fmtHM(r.minutes)}</div>
          <div class="rec-stars">${stars}</div>
          <div class="rec-pts mono">+${r.points_earned.toFixed(1)}P</div>
          <button class="icon-btn" data-edit="${r.id}" title="編集">✎</button>
          <button class="icon-btn del" data-del="${r.id}" title="削除">✕</button>
        </div>
        ${r.content ? `<div class="rec-content">${escapeHtml(r.content)}</div>` : ""}
        ${tagSpans || examSpans ? `<div class="rec-tags">${tagSpans}${examSpans}</div>` : ""}
      </div>`;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── 編集ポップアップ(タイトルは常時・タグ/試験は当日のみ) ──
  let editingRec = null;
  function openEdit(id) {
    editingRec = records.find((r) => r.id === id);
    if (!editingRec) return;
    const locked = editingRec.date !== todayIso();
    root.querySelector("#editSummary").innerHTML = `<b class="mono">${editingRec.date.slice(5).replace("-", "/")}</b>  <span class="mono">${fmtHM(editingRec.minutes)}</span>`;
    root.querySelector("#editTitle").value = editingRec.content || "";
    const tagChips = root.querySelector("#editTagChips");
    const examChips = root.querySelector("#editExamChips");
    tagChips.innerHTML = tagChipsHtml(tags, editingRec.tag_ids || []);
    examChips.innerHTML = examChipsHtml(exams, editingRec.exam_ids || []);
    [tagChips, examChips].forEach((el) => {
      el.querySelectorAll(".chip").forEach((c) => c.classList.toggle("locked", locked));
    });
    root.querySelector("#editTagLbl").textContent = locked ? "タグ 🔒" : "タグ";
    root.querySelector("#editExamLbl").textContent = locked ? "関連する試験 🔒" : "関連する試験(複数選択可)";
    root.querySelector("#editLockHint").style.display = locked ? "block" : "none";
    editErr.reset();
    root.querySelector("#editOverlay").classList.add("open");
  }
  const editErr = createFormError(root.querySelector("#editErr"));
  root.querySelector("#editTitle").addEventListener("input", () => editErr.clear());
  bindChipToggle(root.querySelector("#editTagChips"));
  bindChipToggle(root.querySelector("#editExamChips"));

  root.querySelector("#editSaveBtn").addEventListener("click", async () => {
    if (!editingRec) return;
    const locked = editingRec.date !== todayIso();
    const patch = { content: root.querySelector("#editTitle").value.trim() };
    if (!locked) {
      patch.tag_ids = selectedChipIds(root.querySelector("#editTagChips"), "tag");
      patch.exam_ids = selectedChipIds(root.querySelector("#editExamChips"), "exam");
    }
    const res = await api.update_record(editingRec.id, patch);
    if (!res || !res.ok) { editErr.show((res && res.error) || "更新に失敗しました"); return; } // 編集画面も、追加画面と同じエラー表示
    root.querySelector("#editOverlay").classList.remove("open");
    await reload();
  });

  // ── 削除確認(ダイアログは components/dialog.js に統一。danger なので、最初のフォーカスと Enter はキャンセル) ──
  let deleting = false;
  async function askDelete(id) {
    const r = records.find((x) => x.id === id);
    if (!r || deleting) return;
    deleting = true;
    try {
      const ok = await showConfirm(
        `${r.date.slice(5).replace("-", "/")}  ${fmtHM(r.minutes)} の記録を削除しますか？ ${r.points_earned.toFixed(1)}P返却されます。`,
        { title: "記録の削除", okText: "削除する", danger: true });
      if (!ok) return;
      // 縮小・フェードアウトしながら消え、後ろの記録が滑らかに上がってくる。その日の最後の記録なら、日付の見出しごと消える。
      // API の完了と、消える動きの両方を待ってから描き直す(ポイントは削除が済んだらすぐ数え直す)
      const row = root.querySelector(`.rec[data-rec-id="${id}"]`);
      const group = row && row.closest(".day-group");
      const exit = shrinkOut(group && group.querySelectorAll(".rec").length === 1 ? group : row);
      const removed = api.delete_record(id).then(() => refreshPoints(api)); // 削除した記録のぶん、ポイントが戻る
      await Promise.all([removed, finished(exit)]);
      await reload();
    } finally { deleting = false; }
  }

  await reload();
}
