// Study Tracker v3 - ショップタブ
// 並び順・購入できるか・目標の進み具合・履歴の整形はすべて Python 側(data_manager.shop_data)で済ませてあり、
// ここでは並べて描き、操作を API に渡すだけ。ポップアップ(購入・並び替え・削除・追加/編集)は
// カレンダー/統計と同じ理由で body 直下に置く(#content の container-type の影響を避けるため)。

import { celebrateAt } from "../components/celebrate.js";
import { catmullRom2bezier } from "../components/chart.js";
import { mountPoints, setBalance } from "../components/points.js";
import { captureRects, playFlip, growIn, shrinkOut, finished } from "../components/motion.js";
import { makeSortable } from "../components/sortable.js";
import { showConfirm } from "../components/dialog.js";
import { createFormError } from "../components/formError.js";

let viewToken = 0;     // タブを離れた/開き直した後に、古い非同期処理が描画しないための印
let popups = [];       // body 直下に置いたポップアップ(離脱時に取り除く)
let costObserver = null;

function cleanup() {
  popups.forEach((p) => p.remove());
  popups = [];
  if (costObserver) { costObserver.disconnect(); costObserver = null; }
}
export function onLeave() {
  viewToken++;
  cleanup();
}

const pad2 = (n) => String(n).padStart(2, "0");
function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}
function toHalfWidth(s) {
  return String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[．，]/g, ".");
}
// ポイントは小数第1位まで(整数なら小数なし)
const fmtP = (n) => Number(Number(n).toFixed(1)).toLocaleString();
// 今年と同じなら MM/DD、違う年なら YYYY/MM/DD
function fmtDate(iso) {
  const [y, m, d] = iso.split("-");
  return y === String(new Date().getFullYear()) ? `${m}/${d}` : `${y}/${m}/${d}`;
}
function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export async function render(root, api) {
  const token = ++viewToken;
  cleanup();

  let data = null;
  let reqId = 0;
  let runHours = 2;

  const $ = (sel) => root.querySelector(sel);
  const alive = () => token === viewToken;

  root.innerHTML = `
    <div class="top"><h1>ショップ</h1><div class="right"><span class="pts mono" id="shPts">…</span></div></div>

    <button class="add-btn" id="shAddBtn">＋ 報酬を追加</button>

    <div class="sh-sabori" id="shSabori" data-flip="sabori"></div>

    <div id="shGoals"></div>

    <div class="sh-sect-head" data-flip="head">
      <div class="sect-lbl" style="margin:0;">交換できる報酬</div>
      <button class="btn muted small" id="shReorderBtn">並び替え</button>
    </div>
    <div class="sh-grid" id="shGrid"></div>

    <div class="sect-lbl" style="margin-top:20px;" data-flip="hist-label">購入履歴・直近</div>
    <div id="shHistory" data-flip="hist"></div>
  `;

  // ── ポップアップ(body 直下) ──
  function makePopup(html) {
    const el = document.createElement("div");
    el.className = "modal-overlay";
    el.innerHTML = `<div class="modal-box">${html}</div>`;
    document.body.appendChild(el);
    popups.push(el);
    el.addEventListener("click", (e) => {
      if (e.target === el || (e.target.dataset && e.target.dataset.act === "close")) closePopup(el);
    });
    return el;
  }
  const openPopup = (el) => el.classList.add("open");
  function closePopup(el) {
    el.classList.remove("open");
    if (el === formEl && costObserver) { costObserver.disconnect(); costObserver = null; }
  }

  const buyEl = makePopup(`
    <div class="modal-title" id="shBuyTitle"></div>
    <div class="sh-qty-control" id="shQtyControl">
      <button class="sh-qty-btn" data-qty="-1">−</button>
      <span class="sh-qty mono" id="shQtyVal">1</span>
      <button class="sh-qty-btn" data-qty="1">＋</button>
    </div>
    <div class="sh-buy-total" id="shBuyTotal"></div>
    <div class="form-err" id="shBuyErr" hidden></div>
    <div class="modal-actions">
      <button class="btn muted" data-act="close">キャンセル</button>
      <button class="btn primary" id="shBuyConfirm">購入する</button>
    </div>`);

  const reorderEl = makePopup(`
    <button class="modal-close" data-act="close">✕</button>
    <div class="modal-title">報酬の並び替え</div>
    <div class="sh-ro-note">左の「=」をドラッグして並び替えられます(フォーカスして ↑↓ キーでも動かせます)。★のお気に入りは常に先頭に固定されます。</div>
    <div id="shReorderList"></div>
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn primary" data-act="close">完了</button>
    </div>`);

  const formEl = makePopup(`
    <button class="modal-close" data-act="close">✕</button>
    <div class="modal-title" id="shFormTitle"></div>
    <div class="field"><div class="flbl">名称</div><input class="finput wide" id="shNameInput" maxlength="40" placeholder="例: 好きな漫画1話" autocomplete="off"></div>
    <div class="field">
      <div class="flbl">必要ポイント</div>
      <div class="sh-cost-row"><input class="finput mono" id="shCostInput" inputmode="numeric" autocomplete="off"><span class="sh-unit">P</span></div>
    </div>
    <div class="sh-cc-wrap">
      <div class="sh-cc-lbl">参考: ポイント換算グラフ(現在の換算式)</div>
      <div class="sh-cc-chart" id="shCostChart"></div>
      <div class="sh-cc-hint mono" id="shCostHint"></div>
      <div class="sh-cc-runs">
        <div class="sh-cc-stepper">
          <button class="sh-cc-step" data-run="-1">−</button>
          <span class="sh-cc-rh mono" id="shRunHours">2</span><span>時間</span>
          <button class="sh-cc-step" data-run="1">＋</button>
        </div>
        <span>の学習が</span><span class="sh-cc-rc mono" id="shRunCount">-</span><span>回分</span>
      </div>
    </div>
    <div class="form-err" id="shFormErr" hidden></div>
    <div class="modal-actions">
      <button class="btn muted" data-act="close">キャンセル</button>
      <button class="btn primary" id="shFormSave">保存する</button>
    </div>`);

  const $b = (sel) => buyEl.querySelector(sel);
  const $r = (sel) => reorderEl.querySelector(sel);
  const $f = (sel) => formEl.querySelector(sel);
  // 既存のエラー文も、追加・編集画面と同じ動き(高さが滑らかに広がり、入力が始まるとフェードして消える)にする
  const buyErr = createFormError($b("#shBuyErr"));
  const formErr = createFormError($f("#shFormErr"));
  formErr.watch([$f("#shNameInput"), $f("#shCostInput")]);

  // ── 読み込み / 描画 ──
  // flipFrom: 並びが変わる操作の前に captureRects() で記録した位置。渡すと、描画の直後に、元の位置から新しい位置へ滑らかに動かす
  async function load({ flipFrom = null } = {}) {
    const my = ++reqId;
    let d = null;
    try {
      d = await api.get_shop();
    } catch (e) {
      console.error(e);
    }
    if (!alive() || my !== reqId) return;
    if (!d) {
      $("#shGrid").innerHTML = `<div class="empty-note" style="grid-column:1/-1;">データを取得できませんでした(API エラー。ページを再読み込みしても直らない場合は、お知らせください)。</div>`;
      return;
    }
    data = d;
    paint();
    if (flipFrom) playFlip(root, flipFrom);
  }

  function paint() {
    mountPoints($("#shPts"), data.points_balance);
    paintSabori();
    paintGoals();
    paintGrid();
    paintHistory();
    if (reorderEl.classList.contains("open")) paintReorder();
  }

  function buyButton(item) {
    return item.affordable
      ? `<button class="btn primary" data-act="buy" data-id="${item.id}">購入する</button>`
      : `<button class="btn disabled" disabled>ポイント不足</button>`;
  }
  const iconButtons = (item) => `
    <div class="sh-icons">
      <button class="icon-btn" data-act="edit" data-id="${item.id}" title="編集">✎</button>
      <button class="icon-btn del" data-act="del" data-id="${item.id}" title="削除">✕</button>
    </div>`;

  function paintSabori() {
    const s = data.sabori;
    const btn = s.full ? `<button class="btn disabled" disabled>上限です</button>`
      : !s.affordable ? `<button class="btn disabled" disabled>ポイント不足</button>`
      : `<button class="btn primary" data-act="sabori">購入する</button>`;
    $("#shSabori").innerHTML = `
      <div class="sh-sabori-main">
        <div class="sh-sabori-head"><span class="name">🎟 さぼり券</span><span class="owned mono">所持 ${s.owned}/${s.max}枚</span></div>
        <div class="sh-sabori-note">勉強もアプリの起動もなかった日に自動で使われ、連続記録を守ります(最大${s.max}枚まで所持)</div>
      </div>
      <div class="sh-sabori-buy"><span class="unit mono">${s.price.toLocaleString()}P</span>${btn}</div>`;
  }

  function paintGoals() {
    $("#shGoals").innerHTML = data.goals.map((it) => `
      <div class="sh-goal${it.affordable ? " ready" : ""}" data-flip="r${it.id}">
        <div class="sh-goal-top">
          <div><div class="sh-goal-name">🎯 ${esc(it.name)}</div><div class="sh-goal-cost mono">${it.cost.toLocaleString()}P</div></div>
          <div class="sh-marks"><button class="sh-mark active goal" data-act="goal" data-id="${it.id}" title="目標を解除">🎯</button></div>
        </div>
        <div class="sh-goal-track"><div class="sh-goal-fill" style="width:${it.progress_pct}%"></div></div>
        <div class="sh-goal-label mono">${fmtP(data.points_balance)} / ${it.cost.toLocaleString()}P (${it.progress_pct}%)</div>
        <div class="sh-actions">${buyButton(it)}${iconButtons(it)}</div>
      </div>`).join("");
  }

  function paintGrid() {
    $("#shGrid").innerHTML = data.grid.length
      ? data.grid.map((it) => `
        <div class="sh-card" data-flip="r${it.id}">
          <div class="sh-card-top">
            <div class="sh-card-name">${esc(it.name)}</div>
            <div class="sh-marks">
              <button class="sh-mark${it.favorite ? " active fav" : ""}" data-act="fav" data-id="${it.id}" title="お気に入り">${it.favorite ? "★" : "☆"}</button>
              <button class="sh-mark" data-act="goal" data-id="${it.id}" title="目標に設定">🎯</button>
            </div>
          </div>
          <div class="sh-cost mono${it.affordable ? "" : " high"}">${it.cost.toLocaleString()}P</div>
          <div class="sh-actions">${buyButton(it)}${iconButtons(it)}</div>
        </div>`).join("")
      : `<div class="empty-note" style="grid-column:1/-1;">交換できる報酬がありません。「＋ 報酬を追加」から登録できます。</div>`;
  }

  function paintHistory() {
    $("#shHistory").innerHTML = data.history.length
      ? data.history.map((h) => `
        <div class="sh-hist-row"><span class="l">${fmtDate(h.date)} ・ ${esc(h.name)} ×${h.qty}</span><span class="d mono">${Number(h.delta).toFixed(1)}</span></div>`).join("")
      : `<div class="empty-note">まだ購入履歴はありません</div>`;
  }

  function findItem(id) {
    return data.goals.find((x) => x.id === id) || data.grid.find((x) => x.id === id);
  }

  // ── 購入 ──
  let buy = null; // { kind, id, name, cost, qty, maxQty }
  let confirming = false;

  function updateBuy() {
    const total = buy.cost * buy.qty;
    $b("#shBuyTitle").textContent = `「${buy.name}」を購入`;
    $b("#shQtyVal").textContent = buy.qty;
    $b("#shBuyTotal").innerHTML = `合計 <b class="mono">${total.toLocaleString()}P</b> ・ 残り ${fmtP(data.points_balance - total)}P`;
    buyErr.clear(); // 数量を変えたら、前のエラーは消す
  }
  function askBuy(item) {
    buy = { kind: "reward", id: item.id, name: item.name, cost: item.cost, qty: 1, maxQty: Math.max(1, item.max_qty) };
    $b("#shQtyControl").style.display = "flex";
    updateBuy();
    buyErr.reset();
    openPopup(buyEl);
  }
  function askBuySabori() {
    buy = { kind: "sabori", name: "さぼり券", cost: data.sabori.price, qty: 1, maxQty: 1 };
    $b("#shQtyControl").style.display = "none";
    updateBuy();
    buyErr.reset();
    openPopup(buyEl);
  }
  buyEl.addEventListener("click", (e) => {
    const q = e.target.closest("[data-qty]");
    if (!q || !buy) return;
    buy.qty = Math.min(buy.maxQty, Math.max(1, buy.qty + Number(q.dataset.qty))); // いまのポイントで買える数まで
    updateBuy();
  });
  $b("#shBuyConfirm").addEventListener("click", async (e) => {
    if (!buy || confirming) return;
    confirming = true;
    const btn = e.currentTarget;
    const snapshot = { ...buy };
    try {
      const res = snapshot.kind === "sabori" ? await api.buy_sabori_ticket() : await api.buy_reward(snapshot.id, snapshot.qty);
      if (!alive()) return;
      if (!res || !res.ok) {
        buyErr.show((res && res.error) || "購入できませんでした");
        await load(); // ポイントが変わっていた場合に備えて表示を更新
        return;
      }
      setBalance(res.points_balance); // ヘッダーのポイントを数え下げる
      // 演出はボタンの位置から出すので、ポップアップを閉じる前に呼ぶ
      celebrateAt(btn, snapshot.kind === "sabori" ? "✓ さぼり券を購入しました"
        : `✓ 「${snapshot.name}」${snapshot.qty > 1 ? `×${snapshot.qty} ` : ""}と交換しました`);
      closePopup(buyEl);
      await load();
    } finally {
      confirming = false;
    }
  });

  // ── 並び替え ──
  function paintReorder() {
    $r("#shReorderList").innerHTML = data.grid.map((it) => `
      <div class="sh-ro-row sort-item" data-flip="ro-${it.id}" data-sort-key="${it.id}" data-fav="${it.favorite ? 1 : 0}">
        <span class="sort-handle" tabindex="0" role="button" aria-label="${esc(it.name)}を並び替え(ドラッグ、または ↑↓ キー)" title="ドラッグで並び替え"></span>
        <div class="nm">${it.favorite ? '<span class="fav">★</span>' : ""}<span>${esc(it.name)}</span></div>
      </div>`).join("") || `<div class="empty-note">並び替えできる報酬がありません</div>`;
  }
  // 並び替え: 「=」をドラッグ(または、フォーカスして ↑↓ キー)。入る場所を線で示し、離すとその場所へ滑らかにスライドして入れ替わる。
  // お気に入りは先頭固定なので、お気に入りと通常の境界は越えられない(range)。背面のカードも一緒に滑らかに入れ替わる。
  makeSortable($r("#shReorderList"), {
    itemSel: ".sh-ro-row", handleSel: ".sort-handle", flipRoots: [reorderEl, root],
    range: (others, dragged) => {
      const favCount = others.filter((o) => o.dataset.fav === "1").length;
      return dragged.dataset.fav === "1" ? [0, favCount] : [favCount, others.length];
    },
    commit: (keys) => {
      const byId = new Map(data.grid.map((it) => [String(it.id), it]));
      data.grid = keys.map((k) => byId.get(k));
      paintGrid();
      paintReorder();
    },
    persist: async (keys) => {
      const res = await api.set_reward_order(keys.map(Number));
      // 成功したら、画面はすでに新しい並びなので描き直さない(滑らかな移動を途中で切らないため)。失敗したら、保存済みの並びに戻す
      if (!res || !res.ok) await load();
    },
  });

  // ── 削除(ダイアログは components/dialog.js に統一。danger なので、最初のフォーカスと Enter はキャンセル) ──
  let deleting = false;
  async function askDelete(item) {
    if (deleting) return;
    deleting = true;
    try {
      const ok = await showConfirm(`「${item.name}」を削除しますか？`, { title: "報酬の削除", okText: "削除する", danger: true });
      if (!ok || !alive()) return;
      const id = item.id;
      // 縮小・フェードアウトしながら消える(目標カードも同じ)。API の完了も待ってから描き直す。
      // グリッドでは、消えたあとに後ろのカードが左へ詰まるので、その移動も滑らかにする(消えた状態の位置から FLIP)
      const exit = shrinkOut($(`[data-flip="r${id}"]`));
      await Promise.all([api.delete_reward(id), finished(exit)]);
      if (!alive()) return;
      await load({ flipFrom: captureRects(root) });
    } finally { deleting = false; }
  }

  // ── 追加 / 編集フォーム + 換算グラフ ──
  let editingId = null;
  let lastRef = null;

  const costValue = () => parseFloat(toHalfWidth($f("#shCostInput").value).trim()) || 0;

  function drawCostChart() {
    if (!lastRef) return;
    const ref = lastRef, cost = costValue();
    const box = $f("#shCostChart");
    const steps = 10;
    const W = Math.round(box.clientWidth) || 336;
    const H = 84, padX = 14, top = 14, bottom = 10;
    const maxHour = ref.hours[steps];
    const maxVal = Math.max(...ref.vals, cost, 1);
    const xs = ref.hours.map((_, i) => padX + i * ((W - 2 * padX) / steps));
    const ys = ref.vals.map((v) => (H - bottom) - (v / maxVal) * (H - bottom - top));
    const pts = xs.map((x, i) => [x, ys[i]]);
    const pathD = catmullRom2bezier(pts);
    const areaD = `${pathD} L${xs[steps]},${H} L${xs[0]},${H} Z`;

    let marker = "";
    if (cost > 0 && ref.needed_hours != null) {
      const mx = padX + (ref.needed_hours / maxHour) * (W - 2 * padX);
      const my = (H - bottom) - (Math.min(cost, maxVal) / maxVal) * (H - bottom - top);
      marker = `<circle cx="${mx}" cy="${my}" r="4" fill="var(--stamp)"/>`;
    }
    // 値ラベル・軸ラベルは1つおきに間引く(狭い幅でも重ならないように)
    const shown = (i) => i % 2 === 0;
    const labels = pts.map((p, i) => shown(i)
      ? `<text x="${p[0]}" y="${Math.max(10, p[1] - 7)}" text-anchor="middle" class="sh-cc-label">${Math.round(ref.vals[i])}</text>` : "").join("");
    box.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}">
        <defs><linearGradient id="shCcGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="var(--ink)" stop-opacity="0"/>
        </linearGradient></defs>
        <path d="${areaD}" fill="url(#shCcGrad)" stroke="none"/>
        <path d="${pathD}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${labels}${marker}
      </svg>
      <div class="sh-cc-hlabels">${ref.hours.map((h, i) => (shown(i) ? `<span>${h.toFixed(1)}h</span>` : `<span style="visibility:hidden;">-</span>`)).join("")}</div>`;

    $f("#shCostHint").textContent = cost > 0
      ? (ref.needed_hours != null ? `${cost}P ≈ 連続学習時間 約${ref.needed_hours.toFixed(1)}時間` : "現在の換算式では、この必要ポイントに届きません")
      : "";
    $f("#shRunHours").textContent = ref.run_hours;
    $f("#shRunCount").textContent = ref.runs != null ? ref.runs.toFixed(1) : "-";
  }

  let refReq = 0;
  async function refreshCostChart() {
    const my = ++refReq;
    let ref = null;
    try {
      ref = await api.get_reward_cost_reference(costValue(), runHours);
    } catch (e) {
      console.error(e);
    }
    if (!alive() || my !== refReq || !ref || !formEl.classList.contains("open")) return;
    lastRef = ref;
    drawCostChart();
  }
  const refreshSoon = debounce(refreshCostChart, 150);

  function openForm(item) {
    editingId = item ? item.id : null;
    $f("#shFormTitle").textContent = item ? "報酬を編集" : "報酬を追加";
    $f("#shNameInput").value = item ? item.name : "";
    $f("#shCostInput").value = item ? item.cost : 100;
    formErr.reset();
    lastRef = null;
    $f("#shCostChart").innerHTML = "";
    $f("#shCostHint").textContent = "";
    $f("#shRunHours").textContent = runHours;
    $f("#shRunCount").textContent = "-";
    openPopup(formEl);
    refreshCostChart();
    // 表示後に幅が変わったら(ウィンドウのリサイズなど)描き直す。API は呼ばず、取得済みの値を使う
    if (typeof ResizeObserver !== "undefined") {
      if (costObserver) costObserver.disconnect();
      costObserver = new ResizeObserver(() => drawCostChart());
      costObserver.observe($f("#shCostChart"));
    }
    if (!item) $f("#shNameInput").focus();
  }
  $f("#shCostInput").addEventListener("input", refreshSoon);
  formEl.addEventListener("click", (e) => {
    const s = e.target.closest("[data-run]");
    if (!s) return;
    runHours = Math.min(24, Math.max(1, runHours + Number(s.dataset.run)));
    $f("#shRunHours").textContent = runHours;
    refreshCostChart();
  });

  let saving = false;
  async function saveForm() {
    if (saving) return;
    saving = true;
    try {
      const name = $f("#shNameInput").value;
      const cost = toHalfWidth($f("#shCostInput").value).trim();
      const adding = editingId == null;
      const res = adding ? await api.add_reward(name, cost) : await api.update_reward(editingId, name, cost);
      if (!alive()) return;
      if (!res || !res.ok) {
        // Python の入力チェックの文言から、該当の入力欄を朱色にする(名称 / 必要ポイント)
        const message = (res && res.error) || "保存できませんでした";
        const field = message.includes("名称") ? $f("#shNameInput") : message.includes("ポイント") ? $f("#shCostInput") : null;
        formErr.show(message, field ? { fields: [field] } : {});
        return;
      }
      closePopup(formEl);
      await load();
      // 追加したカードを、周りを押しのけながら拡大・フェードインで出す(編集のときは出さない)
      if (adding && res.reward) growIn($(`.sh-card[data-flip="r${res.reward.id}"]`));
    } finally {
      saving = false;
    }
  }
  $f("#shFormSave").addEventListener("click", saveForm);
  [$f("#shNameInput"), $f("#shCostInput")].forEach((el) =>
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") saveForm(); })
  );

  // ── ページ上の操作(イベント委譲) ──
  root.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const id = Number(t.dataset.id);
    const item = findItem(id);
    switch (t.dataset.act) {
      case "buy": if (item) askBuy(item); break;
      case "sabori": askBuySabori(); break;
      case "edit": if (item) openForm(item); break;
      case "del": if (item) askDelete(item); break;
      case "fav": if (item) { const first = captureRects(root); await api.set_reward_flag(id, !item.favorite, null); await load({ flipFrom: first }); } break;
      case "goal": if (item) { const first = captureRects(root); await api.set_reward_flag(id, null, !item.goal); await load({ flipFrom: first }); } break;
    }
  });
  $("#shAddBtn").addEventListener("click", () => openForm(null));
  $("#shReorderBtn").addEventListener("click", () => { paintReorder(); openPopup(reorderEl); });

  await load();
}
