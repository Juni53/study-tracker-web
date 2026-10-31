// Study Tracker v3 - 設定タブ
import { applyTheme } from "../app.js";
import { mountPoints } from "../components/points.js";
import { showAlert, showConfirm, showChoice } from "../components/dialog.js";
import { showToast } from "../components/celebrate.js";
import { expandIn, collapseOut, finished, growIn, shrinkOut, captureRects, playFlip, reduceMotion } from "../components/motion.js";
import { bindDisclosure } from "../components/disclosure.js";
import { bindRadioGroup } from "../components/radioGroup.js";
import { BUILD_ID, checkNow, isPwaActive } from "../pwa.js";
import { canInstall, promptInstall, isStandalone, installHowTo, onInstallStateChange } from "../components/install.js";
import { showOnboarding } from "../components/onboarding.js";
import { makeSortable } from "../components/sortable.js";
import { createFormError } from "../components/formError.js";
import { validateTagName } from "../components/validate.js";

let chartResizeObserver = null;
export function onLeave() {
  if (chartResizeObserver) { chartResizeObserver.disconnect(); chartResizeObserver = null; }
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function catmullRom2bezier(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}
function fmtVal(v) {
  if (v == null || isNaN(v)) return "-";
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export async function render(root, api) {
  const settings = await api.get_settings();
  let tags = await api.get_tags();

  root.innerHTML = `
    <div class="top"><h1>設定</h1><div class="right"><span class="pts mono" id="ptsTop">…</span></div></div>

    <div class="sect">
      <div class="sect-lbl">表示テーマ</div>
      <div class="theme-row" id="themeRow">
        <button class="tbtn${settings.theme === "system" || !settings.theme ? " active" : ""}" data-theme="system" data-text="システム">システム</button>
        <button class="tbtn${settings.theme === "light" ? " active" : ""}" data-theme="light" data-text="ライト">ライト</button>
        <button class="tbtn${settings.theme === "dark" ? " active" : ""}" data-theme="dark" data-text="ダーク">ダーク</button>
      </div>
    </div>

    <div class="sect">
      <div class="sect-lbl">学習目標</div>
      <div class="goal-grid">
        <div class="set-row"><div class="lbl">日次目標</div><div class="ctrl">
          <input class="finput num" id="dailyGoal" value="${(settings.daily_goal_min / 60).toFixed(1)}"><span class="unit">時間</span>
          <button class="btn muted small" data-save="daily_goal_min" data-src="dailyGoal">更新</button>
        </div></div>
        <div class="set-row"><div class="lbl">月次目標</div><div class="ctrl">
          <input class="finput num" id="monthlyGoal" value="${(settings.monthly_goal_min / 60).toFixed(1)}"><span class="unit">時間</span>
          <button class="btn muted small" data-save="monthly_goal_min" data-src="monthlyGoal">更新</button>
        </div></div>
      </div>
    </div>

    <div class="sect">
      <div class="sect-lbl">タグ</div>
      <button class="add-btn" id="tagAddBtn">＋ タグを追加</button>
      <div id="tagList"></div>
    </div>

    <div class="sect" id="dataSect">
      <div class="sect-lbl">データ管理</div>
      <div class="data-actions">
        <div class="data-note">完全バックアップ(記録・ポイント・設定など、すべてのデータ)</div>
        <div class="data-row">
          <button class="btn primary" id="backupSaveBtn">バックアップを保存</button>
          <button class="btn muted" id="backupRestoreBtn">バックアップから復元</button>
        </div>
        <div class="data-path" id="backupStatus"></div>
        <div class="data-note">バックアップのリマインダー</div>
        <div class="radio-row" id="backupInterval">
          <button class="tbtn" data-days="7" data-text="毎週">毎週</button>
          <button class="tbtn" data-days="14" data-text="2週間ごと">2週間ごと</button>
          <button class="tbtn" data-days="30" data-text="毎月">毎月</button>
          <button class="tbtn" data-days="0" data-text="通知しない">通知しない</button>
        </div>
        <div class="data-path" id="undoRow" hidden>
          <span id="undoText"></span> <button class="btn muted small" id="undoBtn">元に戻す</button>
        </div>
        <div class="data-note">記録だけをCSVで(Excel などで開けます)</div>
        <div class="data-row">
          <button class="btn muted" id="exportBtn">記録をCSVで書き出す</button>
          <button class="btn muted" id="importBtn">記録をCSVから取り込む</button>
        </div>
        <div class="data-path" id="dataPath"></div>
      </div>
    </div>

    <div class="sect" style="border-bottom:none;">
      <div class="sect-lbl">このアプリについて</div>
      <div class="about">バージョン <b>v3.0.0</b> <span class="mono" id="buildId"></span></div>
      <div class="about" id="installRow"></div>
      <div class="about"><button class="btn muted small" id="onboardingBtn">はじめに(使い方の案内)を見る</button></div>
      <div class="about" id="updateRow" hidden><button class="btn muted small" id="updateCheckBtn">最新版を確認</button> <span id="updateResult"></span></div>
    </div>

    <div class="adv-toggle" id="advToggle"><span class="arrow">▸</span><span>高度な設定</span></div>
    <div class="adv-content" id="advContent">

      <div class="sect">
        <div class="sect-lbl">ポイント換算</div>
        <div class="field"><div class="flbl">換算式</div>
          <input class="finput wide" id="formulaInput" value="${esc(settings.point_formula)}">
        </div>
        <div class="formula-note">
          使用可能な変数: <code>minutes</code> <code>hour</code> ・ 関数: <code>floor</code> <code>ceil</code> <code>sqrt</code> <code>log</code> <code>pow</code> ・ 演算子: <code>+</code> <code>-</code> <code>*</code> <code>/</code> <code>^</code>(べき乗)
        </div>
        <div class="guide-toggle" id="guideToggle"><span class="arrow">▸</span><span>ガイドを見る</span></div>
        <div class="guide-content" id="guideContent">
          <div class="guide-row"><span class="k">minutes</span><span class="v">その日の勉強時間(分)</span></div>
          <div class="guide-row"><span class="k">hour</span><span class="v">その日の勉強時間(時間 = minutes/60)</span></div>
          <div class="guide-row"><span class="k">floor(x)</span><span class="v">切り捨て</span></div>
          <div class="guide-row"><span class="k">ceil(x)</span><span class="v">切り上げ</span></div>
          <div class="guide-row"><span class="k">sqrt(x)</span><span class="v">平方根</span></div>
          <div class="guide-row"><span class="k">log(x)</span><span class="v">自然対数</span></div>
          <div class="guide-row"><span class="k">pow(x,y) / x^y</span><span class="v">べき乗</span></div>
          <div class="guide-example">
            <div class="ex-lbl">例(クリックで数式欄に反映):</div>
            <code data-apply="#formulaInput">floor(minutes / 60 * 40)</code>
            <code data-apply="#formulaInput">floor(30 * (minutes / 60) ^ 1.6)</code>
            <code data-apply="#formulaInput">floor(minutes / 60 * 30 + hour ^ 3)</code>
          </div>
        </div>
        <div class="calc-preview">
          <div class="cp-lbl">換算プレビュー(時間ごとの獲得ポイント)</div>
          <div class="calc-chart" id="calcChart"></div>
          <div class="calc-try">
            <span class="lbl">試算:</span>
            <input class="finput" id="calcInput" value="1h30m">
            <span class="arrow">→</span>
            <span class="calc-result mono" id="calcResult"></span>
          </div>
        </div>
        <div class="set-row" style="margin-top:4px;"><span></span>
          <button class="btn muted small" id="formulaSaveBtn">この換算式を保存</button>
        </div>
      </div>

      <div class="sect">
        <div class="sect-lbl">手動入力専用の換算式</div>
        <div class="field"><div class="flbl">換算式</div>
          <input class="finput wide" id="manualFormulaInput" value="${esc(settings.manual_point_formula)}">
        </div>
        <div class="formula-note">
          使用可能な変数: <code>points</code>(1倍での獲得ポイント) ・ 関数/演算子は上と同じ
        </div>
        <div class="guide-toggle" id="manualGuideToggle"><span class="arrow">▸</span><span>ガイドを見る</span></div>
        <div class="guide-content" id="manualGuideContent">
          <div class="guide-row"><span class="k">points</span><span class="v">通常の換算式(1倍)で計算したポイント</span></div>
          <div class="guide-example">
            <div class="ex-lbl">例(クリックで数式欄に反映):</div>
            <code data-apply="#manualFormulaInput">floor(points * 0.75)</code>
          </div>
        </div>
        <div class="set-row" style="margin-top:12px;"><span></span>
          <button class="btn muted small" id="manualFormulaSaveBtn">この換算式を保存</button>
        </div>
      </div>

      <div class="sect">
        <div class="sect-lbl">さぼり券</div>
        <div class="set-row"><div class="lbl">価格</div><div class="ctrl">
          <input class="finput num" id="saboriPrice" value="${settings.sabori_price}"><span class="unit">P</span>
          <button class="btn muted small" data-save="sabori_price" data-src="saboriPrice">更新</button>
        </div></div>
      </div>

      <div class="sect">
        <div class="sect-lbl">ポイントの消失</div>
        <div class="set-row"><div class="lbl">猶予日数</div><div class="ctrl">
          <input class="finput num" id="decayDays" value="${settings.decay_days}"><span class="unit">日</span>
          <button class="btn muted small" data-save="decay_days" data-src="decayDays">更新</button>
        </div></div>
        <div class="set-row"><div class="lbl">1日あたりの減少率</div><div class="ctrl">
          <input class="finput num" id="decayRate" value="${(settings.decay_rate * 100).toFixed(0)}"><span class="unit">%</span>
          <button class="btn muted small" data-save-rate="decay_rate" data-src="decayRate">更新</button>
        </div></div>
      </div>

      <div class="sect">
        <div class="sect-lbl">ボーナス</div>
        <div class="set-row"><div class="lbl">連続達成ボーナスの間隔</div><div class="ctrl">
          <input class="finput num" id="streakDays" value="${settings.streak_bonus_days}"><span class="unit">日毎</span>
          <button class="btn muted small" data-save="streak_bonus_days" data-src="streakDays">更新</button>
        </div></div>
        <div class="set-row"><div class="lbl">連続達成ボーナス</div><div class="ctrl">
          <input class="finput num" id="streakPts" value="${settings.streak_bonus_points}"><span class="unit">P</span>
          <button class="btn muted small" data-save="streak_bonus_points" data-src="streakPts">更新</button>
        </div></div>
        <div class="set-row"><div class="lbl">月間目標達成ボーナス</div><div class="ctrl">
          <input class="finput num" id="monthlyBonus" value="${settings.monthly_goal_bonus}"><span class="unit">P</span>
          <button class="btn muted small" data-save="monthly_goal_bonus" data-src="monthlyBonus">更新</button>
        </div></div>
        <div class="set-row"><div class="lbl">試験目標達成ボーナス</div><div class="ctrl">
          <input class="finput num" id="examBonus" value="${settings.exam_goal_bonus}"><span class="unit">P</span>
          <button class="btn muted small" data-save="exam_goal_bonus" data-src="examBonus">更新</button>
        </div></div>
      </div>

      <div class="sect" style="border-bottom:none;">
        <div class="sect-lbl">危険な操作</div>
        <button class="btn danger" style="width:100%;" id="resetBtn">全データをリセット</button>
      </div>
    </div>

    <div class="modal-overlay" id="tagOverlay">
      <div class="modal-box">
        <button class="modal-close" data-act="close">✕</button>
        <div class="modal-title" id="tagModalTitle">タグを追加</div>
        <div class="field"><div class="flbl">名称</div><input class="finput wide" id="tagNameInput" placeholder="例: 生物"></div>
        <div class="field"><div class="flbl">色</div><div class="swatch-grid" id="swatchGrid"></div></div>
        <div class="form-err" id="tagErr" hidden></div>
        <div class="modal-actions">
          <button class="btn muted" data-act="close">キャンセル</button>
          <button class="btn primary" id="tagSaveBtn">保存する</button>
        </div>
      </div>
    </div>
  `;

  const home = await api.get_home_data();
  mountPoints(root.querySelector("#ptsTop"), home.points_balance);
  // 保存先(Web 版: データはこのブラウザの中)と、保存の状態
  api.get_storage_info().then((info) => {
    const kb = info && info.usage != null ? `使用量 約 ${Math.max(1, Math.round(info.usage / 1024)).toLocaleString()} KB` : "";
    let note;
    if (info && info.volatile) note = "⚠ この環境ではデータが保存されません(タブを閉じると消えます)";
    else if (info && info.persisted === true) note = "ブラウザによる自動削除から保護されています";
    else if (info && info.persisted === false) note = "ブラウザの容量が不足すると、自動で削除される可能性があります。定期的にエクスポートしてください";
    else note = "定期的にエクスポートして、バックアップを取ってください";
    root.querySelector("#dataPath").innerHTML = `保存先: <b>このブラウザの中</b>${kb ? `(${kb})` : ""}<br>${note}`;
  }).catch(() => { root.querySelector("#dataPath").innerHTML = `保存先: <b>このブラウザの中</b>`; });

  root.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.dataset.act === "close") ov.classList.remove("open"); });
  });

  // ── テーマ ──(この列の中だけが対象。同じページの別の列には及ばない)
  bindRadioGroup(root.querySelector("#themeRow"), async (btn) => {
    const mode = btn.dataset.theme;
    applyTheme(mode, { animate: true });
    await api.update_setting("theme", mode);
  });

  // ── 汎用: 数値(時間/分/P/日)の「更新」ボタン ──
  // 「更新」ボタンを押したら、保存できたことをトーストで知らせる(項目名は、同じ行の見出しから取る)
  const rowLabel = (btn) => btn.closest(".set-row")?.querySelector(".lbl")?.textContent.trim() || "設定";
  async function saveSetting(btn, key, value) {
    const res = await api.update_setting(key, value);
    showToast(res && res.ok === false ? `${rowLabel(btn)}を更新できませんでした` : `✓ ${rowLabel(btn)}を更新しました`);
  }
  root.querySelectorAll("[data-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.save;
      const el = root.querySelector("#" + btn.dataset.src);
      let v = parseFloat(el.value);
      if (isNaN(v)) { showToast(`${rowLabel(btn)}は数値で入力してください`); return; }
      if (key === "daily_goal_min" || key === "monthly_goal_min") v = Math.round(v * 60); // 時間 → 分
      await saveSetting(btn, key, v);
    });
  });
  root.querySelectorAll("[data-save-rate]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const el = root.querySelector("#" + btn.dataset.src);
      const v = parseFloat(el.value);
      if (isNaN(v)) { showToast(`${rowLabel(btn)}は数値で入力してください`); return; }
      await saveSetting(btn, btn.dataset.saveRate, v / 100);
    });
  });

  // ── 高度な設定の開閉 ──
  // 開閉する領域(高度な設定・各ガイド)の共通処理。
  // 開くときは、高さを広げながら、中身が上から順にフェードイン+スライドで出る(通常のタブと同じ演出)。
  // 閉じるときは、高さを縮めながらフェードアウトしてから隠す。途中でもう一度押されたら、そこから逆向きにする。
  bindDisclosure(root.querySelector("#advToggle"), root.querySelector("#advContent"), () => refreshFormulaPreview());

  // ── 換算式ガイドの開閉・例の適用 ──
  function bindGuide(toggleId, contentId) {
    bindDisclosure(root.querySelector("#" + toggleId), root.querySelector("#" + contentId));
  }
  bindGuide("guideToggle", "guideContent");
  bindGuide("manualGuideToggle", "manualGuideContent");
  root.querySelectorAll("[data-apply]").forEach((code) => {
    code.addEventListener("click", () => {
      const input = root.querySelector(code.dataset.apply);
      input.value = code.textContent;
      if (code.dataset.apply === "#formulaInput") refreshFormulaPreview();
    });
  });

  // ── 換算式の保存 ──
  root.querySelector("#formulaSaveBtn").addEventListener("click", async () => {
    const res = await api.update_setting("point_formula", root.querySelector("#formulaInput").value);
    showToast(res && res.ok === false ? "換算式を保存できませんでした" : "✓ 換算式を保存しました");
  });
  root.querySelector("#manualFormulaSaveBtn").addEventListener("click", async () => {
    const res = await api.update_setting("manual_point_formula", root.querySelector("#manualFormulaInput").value);
    showToast(res && res.ok === false ? "手動入力の換算式を保存できませんでした" : "✓ 手動入力の換算式を保存しました");
  });

  // ── 換算式プレビュー(グラフ+試算) ──
  function parseDuration(str) {
    str = str.trim();
    let m;
    if ((m = str.match(/^(\d+)h(\d+)?m?$/))) return parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
    if ((m = str.match(/^(\d+):(\d+)$/))) return parseInt(m[1]) * 60 + parseInt(m[2]);
    if ((m = str.match(/^(\d+)$/))) return parseInt(m[1]);
    return null;
  }
  // 遅延実行(debounce)や API の待ち中に、別のタブへ移って画面が無くなっていることがある。その場合は何もしない
  async function renderCalcChart() {
    if (!root.querySelector("#formulaInput")) return;
    const formula = root.querySelector("#formulaInput").value;
    const hours = [0, 1, 2, 3, 4, 5, 6];
    const vals = await Promise.all(hours.map((h) => api.calc_formula_preview(formula, h * 60).then((r) => (r ? r.points : NaN)).catch(() => NaN)));
    const valid = vals.filter((v) => !isNaN(v));
    const max = Math.max(...valid, 0.0001);
    if (!root.querySelector("#calcChart")) return; // API の待ち中に画面が無くなった
    const W = Math.round(root.querySelector("#calcChart").clientWidth) || 700;
    const H = 90, padX = 24, top = 14, bottom = 10;
    const xs = hours.map((h, i) => padX + (i * (W - 2 * padX)) / 6);
    const ys = vals.map((v) => (isNaN(v) ? H - bottom : H - bottom - (Math.max(v, 0) / max) * (H - bottom - top)));
    const points = xs.map((x, i) => [x, ys[i]]);
    const pathD = catmullRom2bezier(points);
    const areaD = `${pathD} L${xs[6]},${H} L${xs[0]},${H} Z`;
    const dots = points.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="var(--stamp)"/>`).join("");
    const labels = points.map((p, i) => `<text x="${p[0]}" y="${Math.max(10, p[1] - 8)}" text-anchor="middle" class="chart-label">${fmtVal(vals[i])}</text>`).join("");
    root.querySelector("#calcChart").innerHTML = `
      <svg viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="cpGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.18"/><stop offset="100%" stop-color="var(--ink)" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${areaD}" fill="url(#cpGrad)" stroke="none"/>
        <path d="${pathD}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}${labels}
      </svg>
      <div class="calc-hlabels">${hours.map((h) => `<span>${h}h</span>`).join("")}</div>`;
  }
  async function updateCalc() {
    if (!root.querySelector("#calcInput")) return; // 別のタブへ移って画面が無い
    const mins = parseDuration(root.querySelector("#calcInput").value);
    const el = root.querySelector("#calcResult");
    if (mins === null) { el.textContent = "入力を認識できません"; return; }
    const r = await api.calc_formula_preview(root.querySelector("#formulaInput")?.value ?? "", mins).catch(() => null);
    el.textContent = r ? fmtVal(r.points) + " P" : "式が無効です";
  }
  const refreshFormulaPreview = debounce(() => { renderCalcChart(); updateCalc(); }, 150);
  root.querySelector("#formulaInput").addEventListener("input", refreshFormulaPreview);
  root.querySelector("#calcInput").addEventListener("input", updateCalc);

  // サイドバー折りたたみ/ウィンドウ幅の変化でグラフ幅が変わるたびに描き直す
  if (chartResizeObserver) chartResizeObserver.disconnect();
  chartResizeObserver = new ResizeObserver(() => { if (root.querySelector("#advContent").classList.contains("open")) renderCalcChart(); });
  chartResizeObserver.observe(root.querySelector("#calcChart"));

  // ── タグ管理 ──
  const SWATCHES = ["#4A90D9", "#E67E22", "#27AE60", "#8E44AD", "#E74C3C", "#7F8C8D", "#16A085", "#2E4C6D", "#8B5E3C"];
  // タグの並び替え: 行の先頭の「=」をドラッグ(または、フォーカスして ↑↓ キー)。カーソルの位置に、入る場所を線で示し、
  // 離すと、その場所へ滑らかにスライドして入れ替わる(components/sortable.js)。コンテナは描き直しても残るので、1回だけ設定する。
  makeSortable(root.querySelector("#tagList"), {
    itemSel: ".tag-row", handleSel: ".sort-handle", flipRoots: [root],
    commit: (keys) => { tags = keys.map((k) => tags.find((t) => t.id === Number(k))); renderTags(); },
    persist: (keys) => api.reorder_tags(keys.map(Number)),
  });
  function renderTags() {
    root.querySelector("#tagList").innerHTML = tags.map((t) => `
      <div class="tag-row sort-item" data-flip="tag-${t.id}" data-tag-id="${t.id}" data-sort-key="${t.id}">
        <div class="left"><span class="sort-handle" tabindex="0" role="button" aria-label="${esc(t.name)}を並び替え(ドラッグ、または ↑↓ キー)" title="ドラッグで並び替え"></span><span class="tag-sw" style="background:${t.color}"></span><span class="tag-name">${esc(t.name)}</span></div>
        <div class="right">
          <button class="icon-btn" data-edit-tag="${t.id}">✎</button>
          <button class="icon-btn del" data-del-tag="${t.id}">✕</button>
        </div>
      </div>`).join("");

    root.querySelectorAll("[data-edit-tag]").forEach((b) => b.addEventListener("click", () => openTagModal(tags.find((t) => t.id === parseInt(b.dataset.editTag, 10)))));
    root.querySelectorAll("[data-del-tag]").forEach((b) => b.addEventListener("click", async () => {
      const id = parseInt(b.dataset.delTag, 10);
      const t = tags.find((x) => x.id === id);
      const row = b.closest(".tag-row");
      if (!t || row.dataset.leaving) return; // 消えている途中(または、もう無い)の行を押しても何もしない(確認も出さない)
      if (!(await showConfirm(`「${t.name}」を削除しますか？`, { title: "タグの削除", okText: "削除する", danger: true }))) return;
      if (row.dataset.leaving) return;
      row.dataset.leaving = "1";
      // 縮小・フェードアウトしながら消え、後ろの行が滑らかに上がってくる(API の完了も待つ)
      const exit = shrinkOut(row);
      await Promise.all([api.delete_tag(id), finished(exit)]);
      tags = tags.filter((x) => x.id !== id);
      renderTags();
    }));
  }
  renderTags();

  // 追加・編集で同じポップアップ。必須はタグ名(エラー時だけ朱色になる)
  const tagErr = createFormError(root.querySelector("#tagErr"));
  tagErr.watch([root.querySelector("#tagNameInput")]);
  let editingTag = null;
  let selectedColor = SWATCHES[0];
  function openTagModal(tag) {
    editingTag = tag || null;
    selectedColor = tag ? tag.color : SWATCHES[0];
    root.querySelector("#tagModalTitle").textContent = tag ? "タグを編集" : "タグを追加";
    root.querySelector("#tagNameInput").value = tag ? tag.name : "";
    root.querySelector("#swatchGrid").innerHTML = SWATCHES.map((c) =>
      `<span class="swatch ${c === selectedColor ? "selected" : ""}" data-color="${c}" style="background:${c}"></span>`
    ).join("");
    tagErr.reset();
    root.querySelector("#tagOverlay").classList.add("open");
  }
  root.querySelector("#tagAddBtn").addEventListener("click", () => openTagModal(null));
  root.querySelector("#swatchGrid").addEventListener("click", (e) => {
    const sw = e.target.closest(".swatch");
    if (!sw) return;
    selectedColor = sw.dataset.color;
    root.querySelectorAll(".swatch").forEach((s) => s.classList.remove("selected"));
    sw.classList.add("selected");
  });
  root.querySelector("#tagSaveBtn").addEventListener("click", async () => {
    const nameEl = root.querySelector("#tagNameInput");
    const v = validateTagName(nameEl.value);
    if (!v.ok) { tagErr.show(v.message, { fields: [nameEl] }); return; }
    const name = v.name;
    let added = null;
    if (editingTag) {
      await api.update_tag(editingTag.id, name, selectedColor);
      editingTag.name = name;
      editingTag.color = selectedColor;
    } else {
      const fresh = await api.add_tag(name, selectedColor);
      tags.push(fresh);
      added = fresh;
    }
    root.querySelector("#tagOverlay").classList.remove("open");
    renderTags();
    // 追加した行を、周りを押しのけながら拡大・フェードインで出す(編集のときは出さない)
    if (added) growIn(root.querySelector(`.tag-row[data-tag-id="${added.id}"]`));
  });

  // ── データ管理 ──
  root.querySelector("#exportBtn").addEventListener("click", async () => {
    const r = await api.export_csv();
    await showAlert(r && r.ok ? `ダウンロードしました:\n${r.path}\n(ブラウザのダウンロード先に保存されます)` : "エクスポートに失敗しました");
  });
  // インポート: エクスポートと同じ形式の CSV(記録)を取り込む。同じ内容の記録は取り込まず、ポイント残高・連続ボーナスなどは動かさない。
  let importing = false;
  root.querySelector("#importBtn").addEventListener("click", async () => {
    if (importing) return;
    importing = true;
    try {
      const r = await api.import_csv();
      if (!r || (r.ok && r.cancelled)) return;
      if (!r.ok) {
        const bad = (r.invalid || []).slice(0, 5).map((x) => `${x.line}行目: ${x.reason}`).join("\n");
        await showAlert(`インポートできませんでした。\n${r.error || ""}${bad ? `\n\n${bad}` : ""}`, { title: "インポート" });
        return;
      }
      const lines = [`${r.added}件の記録を取り込みました。`];
      if (r.duplicates) lines.push(`${r.duplicates}件は同じ内容の記録がすでにあるため、取り込みませんでした。`);
      if (r.invalid_count) {
        lines.push(`${r.invalid_count}行は形式が正しくないため、取り込みませんでした。`);
        r.invalid.slice(0, 5).forEach((x) => lines.push(`  ${x.line}行目: ${x.reason}`));
        if (r.invalid_count > 5) lines.push(`  ほか${r.invalid_count - 5}行`);
      }
      if (r.new_tags && r.new_tags.length) lines.push(`新しいタグを作りました: ${r.new_tags.join("、")}`);
      if (r.unmatched_exams) lines.push(`${r.unmatched_exams}件の試験名は、登録済みの試験に無いため紐づけませんでした。`);
      if (r.added) lines.push("獲得ポイントは記録にだけ持たせました(ポイント残高・連続ボーナスは変わりません)。");
      await showAlert(lines.join("\n"), { title: "インポート" });
      if (r.new_tags && r.new_tags.length) { tags = await api.get_tags(); renderTags(); }
    } finally { importing = false; }
  });

  // ── このアプリについて(版・インストール・更新の確認) ──
  root.querySelector("#buildId").textContent = BUILD_ID === "dev" ? "(開発版)" : `(build ${BUILD_ID})`;
  const installRow = root.querySelector("#installRow");
  function paintInstall() {
    if (!installRow.isConnected) return;
    if (isStandalone()) { installRow.textContent = "アプリとしてインストール済みです。"; return; }
    if (canInstall()) {
      installRow.innerHTML = `<button class="btn muted small" id="installBtn">アプリとしてインストール</button>`;
      installRow.querySelector("#installBtn").addEventListener("click", async () => { await promptInstall(); paintInstall(); });
      return;
    }
    installRow.textContent = installHowTo();
  }
  paintInstall();
  onInstallStateChange(paintInstall);
  // 初回に出る案内を、いつでも見直せる(見たことの記録は変えない)。「データ管理を開く」は、このページの中で移る
  root.querySelector("#onboardingBtn").addEventListener("click", () => {
    showOnboarding(api, { first: false, onOpenBackup: () => root.querySelector("#dataSect")?.scrollIntoView?.({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" }) });
  });
  if (isPwaActive()) {
    root.querySelector("#updateRow").hidden = false;
    const result = root.querySelector("#updateResult");
    root.querySelector("#updateCheckBtn").addEventListener("click", async (e) => {
      e.currentTarget.disabled = true;
      result.textContent = "確認しています…";
      const r = await checkNow();
      result.textContent = { available: "新しいバージョンがあります。右下のお知らせから更新できます。", installing: "新しいバージョンを取得しています。しばらくすると、右下にお知らせが出ます。",
        latest: "最新です。", error: "確認できませんでした(ネットワークを確認してください)。" }[r] ?? "";
      e.currentTarget.disabled = false;
    });
  }

  // ── 完全バックアップ・復元 ──
  const backupStatusEl = root.querySelector("#backupStatus");
  // 表示の更新は「最後に始めたもの」だけを反映する(古い更新が遅れて終わり、新しい表示を上書きしないように)
  let paintSeq = 0;
  const intervalGroup = bindRadioGroup(root.querySelector("#backupInterval"), async (btn) => {
    paintSeq++;                                  // 選んだ時点で、進行中の古い更新を無効にする
    await api.set_backup_interval(Number(btn.dataset.days));
    paintBackup();
  });
  const fmtPts = (n) => (Math.round(n * 100) / 100).toLocaleString();
  async function paintBackup() {
    const seq = ++paintSeq;
    const st = await api.get_backup_status();
    if (seq !== paintSeq) return;
    const last = st.last_backup_at
      ? `最後のバックアップ: ${st.last_backup_at.slice(0, 10)}(${st.days_since === 0 ? "今日" : `${st.days_since}日前`})`
      : "まだバックアップを取っていません";
    backupStatusEl.textContent = `${last}。${st.can_pick_location ? "保存先を選べます" : "ブラウザのダウンロード先に保存されます"}`;
    intervalGroup.setActive((b) => Number(b.dataset.days) === st.interval_days);
    const undoRow = root.querySelector("#undoRow");
    undoRow.hidden = !st.undo;
    if (st.undo) root.querySelector("#undoText").textContent = `${st.undo.saved_at.replace("T", " ").slice(0, 16)} の${st.undo.reason}の状態に戻せます。`;
  }
  paintBackup().catch(() => {});

  root.querySelector("#backupSaveBtn").addEventListener("click", async () => {
    const r = await api.save_backup();
    if (r.cancelled) return;
    if (!r.ok) { await showAlert(`バックアップを保存できませんでした。\n${r.error || ""}`, { title: "バックアップ" }); return; }
    await showAlert(`バックアップを保存しました。\n${r.filename}(記録 ${r.records}件)${r.method === "download" ? "\nブラウザのダウンロード先に保存されます。" : ""}`, { title: "バックアップ" });
    paintBackup();
  });

  let restoring = false;
  root.querySelector("#backupRestoreBtn").addEventListener("click", async () => {
    if (restoring) return;
    restoring = true;
    try {
      const p = await api.pick_backup_file();
      if (p.cancelled) return;
      if (!p.ok) {
        const probs = (p.problems || []).map((x) => `・${x}`).join("\n");
        await showAlert(`読み込めませんでした。\n${p.error || ""}${probs ? `\n\n${probs}` : ""}`, { title: "バックアップから復元" });
        return;
      }
      const s = p.summary, inc = s.incoming, cur = s.current;
      const kind = s.format === "desktop" ? "デスクトップ版のデータ" : "Study Tracker のバックアップ";
      const when = s.exported_at ? `(${s.exported_at.replace("T", " ").slice(0, 16)} 作成)` : "";
      const range = inc.first_date ? `${inc.first_date} 〜 ${inc.last_date}` : "記録なし";
      const msg = [
        `ファイル: ${s.name}`, `種類: ${kind}${when}`, "",
        `このファイルの内容: 記録 ${inc.records}件(${range})/ポイント ${fmtPts(inc.points_balance)}`,
        `いまのデータ: 記録 ${cur.records}件 / ポイント ${fmtPts(cur.points_balance)}`, "",
        "【上書きして復元】いまのデータをすべて、このファイルの内容に置き換えます。",
        "【記録だけ統合】このファイルにあって、いまのデータに無い記録だけを足します。ポイント・設定などは、いまのままです。", "",
        "実行の前に、いまのデータを自動で控えます(設定から元に戻せます)。",
      ].join("\n");
      const choice = await showChoice(msg, { title: "バックアップから復元", okText: "上書きして復元", altText: "記録だけ統合", cancelText: "キャンセル", danger: true });
      if (!choice) return;
      const r = await api.apply_backup(choice === "ok" ? "replace" : "merge");
      if (!r.ok) { await showAlert(`復元できませんでした。\n${r.error || ""}`, { title: "バックアップから復元" }); return; }
      const lines = r.mode === "replace"
        ? [`復元しました(記録 ${r.records}件)。`]
        : [`${r.added}件の記録を統合しました。`,
           ...(r.duplicates ? [`${r.duplicates}件は同じ内容の記録がすでにあるため、足しませんでした。`] : []),
           ...(r.new_tags.length ? [`新しいタグを作りました: ${r.new_tags.join("、")}`] : []),
           ...(r.new_exams.length ? [`新しい試験を作りました: ${r.new_exams.join("、")}`] : []),
           "ポイント・設定などは、変わっていません。"];
      await showAlert(`${lines.join("\n")}\nアプリを再読み込みします。`, { title: "バックアップから復元" });
      await api.reload_app();
    } finally { restoring = false; }
  });

  root.querySelector("#undoBtn").addEventListener("click", async () => {
    const st = await api.get_backup_status();
    if (!st.undo) return;
    const ok = await showConfirm(`${st.undo.saved_at.replace("T", " ").slice(0, 16)} の${st.undo.reason}の状態に戻します。いまのデータは失われます。`,
      { title: "元に戻す", okText: "元に戻す", danger: true });
    if (!ok) return;
    const r = await api.undo_last_restore();
    if (!r.ok) { await showAlert(`元に戻せませんでした。\n${r.error || ""}`, { title: "元に戻す" }); return; }
    await showAlert(`元に戻しました(記録 ${r.records}件)。\nアプリを再読み込みします。`, { title: "元に戻す" });
    await api.reload_app();
  });

  // ── 全データリセット ──
  // 確認は components/dialog.js に統一(danger なので、最初のフォーカスと Enter はキャンセル)
  root.querySelector("#resetBtn").addEventListener("click", async () => {
    const ok = await showConfirm("このブラウザに保存されたデータ(記録・ポイント・設定など)がすべて完全に削除されます。この操作は取り消せません。削除後、アプリは自動的に再読み込みされます。",
      { title: "⚠ 全データをリセット", okText: "完全に削除する", danger: true });
    if (ok) api.reset_all_data();
  });
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
