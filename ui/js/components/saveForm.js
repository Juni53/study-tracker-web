// Study Tracker v3 - 記録の保存ポップアップ(ストップウォッチ保存 / 手動追加 共通)
import { tagChipsHtml, examChipsHtml, bindChipToggle, selectedChipIds } from "./pickers.js";
import { mountStars } from "./stars.js";
import { celebrateAt } from "./celebrate.js";
import { refreshPoints } from "./points.js";
import { attachDateSteppers } from "./dateStepper.js";
import { createFormError } from "./formError.js";
import { validateManualRecord } from "./validate.js";

function todayParts() {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

// opts:
//   api          : Api インスタンス
//   source       : "stopwatch" | "manual"
//   minutes      : ストップウォッチ時のみ。固定の経過分数
//   dateStr / startTime : ストップウォッチ時のみ。計測を開始した日("YYYY-MM-DD")と時刻("HH:MM")
//   defaultTitle : 任意
//   onSaved(rec) : 保存成功時に呼ばれる
export async function openSaveForm(api, opts) {
  const { source, onSaved } = opts;
  const [tags, exams] = await Promise.all([api.get_tags(), api.get_exams()]);

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const { y, m, d } = todayParts();
  let quality = 3;

  overlay.innerHTML = `
    <div class="modal-box">
      <button class="modal-close" data-act="close">✕</button>
      <div class="sf-head">
        <span class="sf-title">${source === "stopwatch" ? "記録を保存" : "記録を手動で追加"}</span>
        <span class="sf-est mono" id="sfEst">…</span>
      </div>
      ${source === "manual" ? `<div class="sf-base mono" id="sfBase"></div>` : ""}
      ${source === "manual" ? `
        <div class="field"><div class="flbl">日付</div>
          <div class="date-row">
            <input class="finput y mono" id="fY" value="${y}"><span>年</span>
            <input class="finput mono" id="fM" value="${String(m).padStart(2, "0")}"><span>月</span>
            <input class="finput mono" id="fD" value="${String(d).padStart(2, "0")}"><span>日</span>
          </div>
        </div>
        <div class="field"><div class="flbl">勉強時間</div>
          <div class="date-row"><input class="finput" id="fDur" value="1h30m" style="width:110px;"></div>
        </div>
      ` : `
        <div class="sf-note" id="sfNote"></div>
      `}
      <div class="field"><div class="flbl">タイトル(任意)</div><input class="finput wide" id="fTitle" placeholder="例: 微分の演習"></div>
      <div class="field"><div class="flbl">充実度</div><div class="stars" id="fStars"></div></div>
      <div class="field"><div class="flbl">タグ</div><div class="chips" id="fTags">${tagChipsHtml(tags, [])}</div></div>
      <div class="field"><div class="flbl">関連する試験(複数選択可)</div><div class="chips" id="fExams">${examChipsHtml(exams, [])}</div></div>
      <div class="form-err" id="sfErr" hidden></div>
      <div class="modal-actions">
        <button class="btn muted" data-act="close">キャンセル</button>
        <button class="btn primary" data-act="save">保存する</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  void overlay.offsetWidth; // 閉じた状態を一度描画させてから open を付ける(付けないと、いきなり開いた状態になり、遷移しない)
  overlay.classList.add("open");

  const close = () => {
    overlay.classList.remove("open");
    setTimeout(() => overlay.remove(), 450); // 閉じるアニメーション(約0.2秒)が終わってから取り除く
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.dataset.act === "close") close();
  });

  mountStars(overlay.querySelector("#fStars"), { value: quality, onChange: (v) => { quality = v; } });
  const err = createFormError(overlay.querySelector("#sfErr"));
  bindChipToggle(overlay.querySelector("#fTags"));
  bindChipToggle(overlay.querySelector("#fExams"));

  async function refreshPreview() {
    const durationText = source === "stopwatch" ? `${opts.minutes}` : (overlay.querySelector("#fDur")?.value || "0");
    const res = await api.preview_points(durationText, source);
    if (!res || !res.ok) return;
    if (source === "stopwatch") {
      const h = Math.floor(res.minutes / 60), mm = res.minutes % 60;
      overlay.querySelector("#sfNote").textContent = `計測時間 ${h ? h + "h" : ""}${String(mm).padStart(2, "0")}m`;
    }
    overlay.querySelector("#sfEst").textContent = `獲得予定 ${res.points.toFixed(1)} P${res.multiplier !== 1 ? ` (×${res.multiplier.toFixed(2)})` : ""}`;
    if (source === "manual") {
      overlay.querySelector("#sfBase").textContent = `1倍: ${res.base_points.toFixed(1)} P`;
    }
  }
  refreshPreview();
  if (source === "manual") {
    overlay.querySelector("#fDur").addEventListener("input", refreshPreview);
    attachDateSteppers(overlay.querySelector("#fY"), overlay.querySelector("#fM"), overlay.querySelector("#fD"));
    err.watch(["#fY", "#fM", "#fD", "#fDur"].map((id) => overlay.querySelector(id)));
  }

  let saving = false;
  overlay.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    if (saving) return;
    const btn = e.currentTarget;
    const $ = (id) => overlay.querySelector(id);
    let dateStr, durationText;
    if (source === "manual") {
      // 必須: 日付(正しい日付)と勉強時間(空でない・形式が正しい)。「タイトル」は任意のまま。
      const v = validateManualRecord({ y: $("#fY").value, m: $("#fM").value, d: $("#fD").value, duration: $("#fDur").value });
      if (!v.ok) {
        const dateFields = { y: "#fY", m: "#fM", d: "#fD" };
        if (v.field.startsWith("date-")) {
          err.show(v.message, { fields: ["#fY", "#fM", "#fD"].map($), focus: $(dateFields[v.field.slice(5)]) });
        } else {
          err.show(v.message, { fields: [$("#fDur")] });
        }
        return;
      }
      dateStr = v.dateStr;
      durationText = v.durationText;
    } else {
      dateStr = opts.dateStr;
      durationText = `${opts.minutes}`;
    }
    const title = $("#fTitle").value.trim();
    const tagIds = selectedChipIds(overlay, "tag");
    const examIds = selectedChipIds(overlay, "exam");

    const startTime = source === "stopwatch" ? (opts.startTime || null) : null;
    saving = true;
    let res;
    try {
      res = await api.add_record(dateStr, durationText, title, tagIds, examIds, source, quality, startTime);
    } finally { saving = false; }
    if (!res || !res.ok) {
      // 時間の形式は Python(parse_duration)が判定する。手動入力なら、勉強時間の入力欄を朱色にして示す
      const message = res && res.error ? res.error : "保存に失敗しました";
      err.show(message, source === "manual" ? { fields: [$("#fDur")] } : {});
      return;
    }
    close();
    refreshPoints(api); // 獲得ポイントや連続ボーナスをヘッダーにすぐ反映(数え上げ)
    celebrateAt(btn, `✓ ${source === "stopwatch" ? "記録を保存しました" : "記録を追加しました"} +${res.record.points_earned.toFixed(1)}P`);
    if (onSaved) onSaved(res.record);
  });
}
