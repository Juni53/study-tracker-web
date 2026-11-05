// Study Tracker v3 - 待機画面(全画面)
// ストップウォッチ・ポモドーロの「見るだけ」の画面。机に立てかけたタブレット・サブ画面などで、離れた場所から時間を読むためのもの。
// ストップウォッチのタブの「待機画面(全画面)」ボタンで開く。閉じるのは、「閉じる」ボタン・Esc キー・(全画面を抜けたとき)。
//
// 表示は 2 種類(画面の下の切り替えで選ぶ。選んだ表示は、設定に保存して、次回も使う):
//   ・通常      … テーマ色(ライト/ダークは、アプリの設定に従う)。動かない。
//   ・有機EL    … スクリーンセーバー。背景は真っ黒(= 発光ゼロ)、文字は抑えた明るさ、細い線。
//                 焼き付き防止のため、表示全体が、ゆっくり少しずつ動く(40 秒ごとに行き先を変え、その間は一定の速さで移動)。
//
// 内容: 現在時刻 / ストップウォッチ(状態・時間・開始時刻) / ポモドーロ(リング・残り時間・フェーズ・サイクル)。
//   ストアを見るだけで、操作(開始・一時停止など)はない(うっかり止めないため)。時間・フェーズの音や通知は、いつもどおり。
//
// 全画面: 使えるブラウザ(PC・Chromebook・Android・iPad)は、本物の全画面にする。使えないとき(iPhone の Safari など)は、
//   画面いっぱいの表示にする(アドレスバーなどは残ることがある)。Esc で全画面を抜けたら、待機画面も閉じる。
// 画面の消灯: 開いている間は、設定に関わらず、消灯・スリープを防ぐ(閉じたら元に戻る。store/pomodoroAlerts.js の setStandbyHold)。
// 操作ボタンは、4 秒操作がないと消える(有機ELでは、固定の明るい部分を作らないため。通常でも同じ)。触れる・動かす・キーを押すと、また出る。
//
// openStandby(api, { opener, doc, fullscreen }) → { close, setMode, state }。すでに開いているときは、それを返す。

import { stopwatch, subscribe, onPhaseChange } from "../store/stopwatch.js";
import { prefs, savePrefs, STANDBY_MODE_KEYS } from "../store/pomodoroPrefs.js";
import { setStandbyHold } from "../store/pomodoroAlerts.js";
import { nowHHMM } from "../core/dates.js";
import { reduceMotion } from "./motion.js";
import { hms, mmss, PHASE_LABEL, startLabel, swStatusLabel, ringOffset } from "./timeFormat.js";

export const STANDBY_MODES = [
  { key: "normal", label: "通常" },
  { key: "oled", label: "有機EL" },
];
export const IDLE_HIDE_MS = 4000;      // 操作がないとき、ボタンを隠すまで
export const DRIFT_STEP_MS = 40000;    // 有機ELの表示が動く 1 区間の長さ(この間、一定の速さで次の位置へ)
export const DRIFT_AMP = 3;            // 動く範囲(画面の短いほうの辺の %。中心から ±3%)

// 有機ELで、表示が動く先(i 番目の区間の終点)。中心から ±amp の範囲で、同じ道をくり返さないよう、割り切れない比で回す(リサージュ曲線)。
// 戻り値の x・y は、vmin 単位(画面の短いほうの辺の 1%)。
export function driftPoint(i, amp = DRIFT_AMP) {
  return { x: Number((Math.sin(i * 2.399) * amp).toFixed(2)), y: Number((Math.cos(i * 1.618) * amp).toFixed(2)) };
}

const RING_JUMP = 20;                  // これ(全周 377 のうち約 5%)を超える変化は、大きな変化(スキップ・フェーズ切り替え)として、速めに動かす
let current = null;
export const isStandbyOpen = () => current !== null;
export function closeStandby() { if (current) current.close(); }

export function openStandby(api, { opener = null, doc = document, fullscreen = true } = {}) {
  if (current) return current;

  const root = doc.createElement("div");
  root.className = "standby";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "待機画面");
  root.tabIndex = -1;
  root.dataset.mode = STANDBY_MODE_KEYS.includes(prefs.standbyMode) ? prefs.standbyMode : "normal";
  root.innerHTML = `
    <div class="sb-stage">
      <div class="sb-clock mono" id="sbClock"></div>
      <section class="sb-sw" aria-label="ストップウォッチ">
        <div class="sb-state"><span class="sb-dot" id="sbDot"></span><span id="sbStatus"></span></div>
        <div class="sb-time mono" id="sbTime">00:00:00</div>
        <div class="sb-start mono" id="sbStart"></div>
      </section>
      <section class="sb-pomo" id="sbPomo" aria-label="ポモドーロタイマー">
        <div class="sb-ring">
          <svg viewBox="0 0 150 150" aria-hidden="true">
            <circle class="sb-ring-track" cx="75" cy="75" r="60" fill="none"/>
            <circle class="sb-ring-bar" id="sbRing" cx="75" cy="75" r="60" fill="none" stroke-linecap="round" stroke-dasharray="377" stroke-dashoffset="0" transform="rotate(-90 75 75)"/>
          </svg>
          <div class="sb-remain mono" id="sbRemain"></div>
        </div>
        <div class="sb-phase" id="sbPhase"></div>
        <div class="sb-cycle" id="sbCycle"></div>
        <div class="sb-dots" id="sbDots" aria-hidden="true"></div>
      </section>
    </div>
    <div class="sb-controls" id="sbControls">
      <div class="sb-seg" role="group" aria-label="表示の種類">
        ${STANDBY_MODES.map((m) => `<button type="button" class="sb-btn" data-sb-mode="${m.key}" aria-pressed="false">${m.label}</button>`).join("")}
      </div>
      <button type="button" class="sb-btn sb-close" id="sbClose" aria-label="待機画面を閉じる">閉じる ✕</button>
    </div>
    <div class="sr-only" role="status" aria-live="polite" id="sbAnnounce"></div>`;

  const $ = (id) => root.querySelector(`#${id}`);
  const el = {
    clock: $("sbClock"), dot: $("sbDot"), status: $("sbStatus"), time: $("sbTime"), start: $("sbStart"),
    pomo: $("sbPomo"), ring: $("sbRing"), remain: $("sbRemain"), phase: $("sbPhase"), cycle: $("sbCycle"), dots: $("sbDots"),
    controls: $("sbControls"), announce: $("sbAnnounce"), stage: root.querySelector(".sb-stage"),
  };
  let closed = false;
  let ringPrev;
  let dotsKey = "";
  let tickTimer = null, idleTimer = null, driftTimer = null, driftIndex = 0;
  let fsActive = false;

  // 文字は、変わったときだけ書き換える(毎秒、同じ文字を書き直さない)
  const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

  function setRing(offset) {
    const ring = el.ring;
    const value = offset.toFixed(1);
    if (ringPrev === undefined || reduceMotion()) {
      ring.style.transition = "none";
      ring.style.strokeDashoffset = value;
      void ring.getBoundingClientRect();         // 動かさずに反映させてから、transition を戻す
      ring.style.transition = "";
    } else {
      ring.style.transition = Math.abs(offset - ringPrev) > RING_JUMP
        ? "stroke-dashoffset .7s cubic-bezier(.22, 1, .36, 1), stroke .4s ease"
        : "stroke-dashoffset 1s linear, stroke .4s ease";
      ring.style.strokeDashoffset = value;
    }
    ringPrev = offset;
  }

  function update() {
    if (closed) return;
    const po = stopwatch.pomodoro;
    setText(el.clock, nowHHMM());
    setText(el.time, hms(stopwatch.currentSeconds()));
    setText(el.status, swStatusLabel());
    setText(el.start, startLabel());
    el.dot.classList.toggle("live", stopwatch.running);

    const remain = stopwatch.pomodoroRemaining();
    setText(el.remain, mmss(remain));
    setText(el.phase, PHASE_LABEL[po.phase]);
    setText(el.cycle, `サイクル ${po.cycle} / ${po.config.cycles}`);
    el.pomo.dataset.phase = po.phase === "work" ? "work" : "break";
    el.pomo.dataset.running = po.running ? "true" : "false";
    setRing(ringOffset(po, remain));
    const key = `${po.cycle}/${po.config.cycles}`;
    if (key !== dotsKey) {
      dotsKey = key;
      el.dots.innerHTML = Array.from({ length: po.config.cycles }, (_, i) => {
        const idx = i + 1;
        return `<span class="sb-cdot ${idx < po.cycle ? "done" : idx === po.cycle ? "cur" : ""}"></span>`;
      }).join("");
    }
  }

  // 自分の 1 秒ごとの見回り(時計の分が変わる・計測が止まっている間も、現在時刻を新しくするため)。計測中の秒の更新は、ストアの通知で、秒の境目に合わせて行う
  function scheduleTick() {
    if (closed) return;
    tickTimer = setTimeout(() => { update(); scheduleTick(); }, 1000);
    if (tickTimer && typeof tickTimer.unref === "function") tickTimer.unref();
  }

  // ── 操作ボタンの自動非表示 ──
  function showControls() {
    if (closed) return;
    root.classList.remove("sb-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (closed) return;
      if (el.controls.contains(doc.activeElement) && doc.activeElement !== root) return;   // キーボードで操作中は、隠さない
      root.classList.add("sb-idle");
    }, IDLE_HIDE_MS);
    if (idleTimer && typeof idleTimer.unref === "function") idleTimer.unref();
  }

  // ── 有機EL: 表示全体を、ゆっくり動かす ──
  function applyDrift() {
    const p = driftPoint(driftIndex);
    el.stage.style.setProperty("--sb-dx", String(p.x));
    el.stage.style.setProperty("--sb-dy", String(p.y));
  }
  function startDrift() {
    stopDrift();
    driftIndex = Math.floor(Date.now() / DRIFT_STEP_MS);       // 開くたびに、違う場所から始める
    applyDrift();
    const step = () => {
      if (closed) return;
      driftIndex += 1;
      applyDrift();
      driftTimer = setTimeout(step, DRIFT_STEP_MS);
      if (driftTimer && typeof driftTimer.unref === "function") driftTimer.unref();
    };
    driftTimer = setTimeout(step, DRIFT_STEP_MS);
    if (driftTimer && typeof driftTimer.unref === "function") driftTimer.unref();
  }
  function stopDrift() {
    clearTimeout(driftTimer);
    driftTimer = null;
    el.stage.style.setProperty("--sb-dx", "0");
    el.stage.style.setProperty("--sb-dy", "0");
  }

  function setMode(mode, { save = true } = {}) {
    if (!STANDBY_MODE_KEYS.includes(mode)) return;
    root.dataset.mode = mode;
    root.querySelectorAll("[data-sb-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sbMode === mode)));
    if (mode === "oled") startDrift(); else stopDrift();
    if (save && prefs.standbyMode !== mode) {
      prefs.standbyMode = mode;
      Promise.resolve(savePrefs(api)).catch((e) => console.error(e));
    }
  }

  // ── 閉じる ──
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {                                       // フォーカスを、待機画面の中に閉じ込める
      const items = [...root.querySelectorAll("button")];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (doc.activeElement === first || doc.activeElement === root)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const onActivity = () => showControls();
  const onFsChange = () => { if (fsActive && !doc.fullscreenElement) { fsActive = false; close(); } };   // Esc などで全画面を抜けた
  const unsubscribe = subscribe(update);
  const unsubscribePhase = onPhaseChange(({ to }) => { el.announce.textContent = `${PHASE_LABEL[to]}に切り替わりました`; });

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(tickTimer); clearTimeout(idleTimer); clearTimeout(driftTimer);
    unsubscribe(); unsubscribePhase();
    root.removeEventListener("keydown", onKey);
    for (const ev of ["pointermove", "pointerdown", "touchstart", "keydown", "focusin"]) root.removeEventListener(ev, onActivity);
    doc.removeEventListener("fullscreenchange", onFsChange);
    const wasFs = fsActive || doc.fullscreenElement === root;
    fsActive = false;
    if (wasFs && doc.fullscreenElement === root && typeof doc.exitFullscreen === "function") Promise.resolve(doc.exitFullscreen()).catch(() => {});
    const app = doc.getElementById("app");
    if (app) app.inert = false;
    doc.documentElement.classList.remove("standby-open");
    root.remove();
    setStandbyHold(false);
    current = null;
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  }

  root.addEventListener("keydown", onKey);
  for (const ev of ["pointermove", "pointerdown", "touchstart", "keydown", "focusin"]) root.addEventListener(ev, onActivity, { passive: true });
  root.querySelector("#sbClose").addEventListener("click", close);
  root.querySelectorAll("[data-sb-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.sbMode)));
  doc.addEventListener("fullscreenchange", onFsChange);

  doc.body.appendChild(root);
  const app = doc.getElementById("app");
  if (app) app.inert = true;                                     // 後ろの画面に、キーボード・読み上げで入らないようにする
  doc.documentElement.classList.add("standby-open");              // 後ろのページのスクロールバーを隠す(全画面にならない環境で、真っ黒の画面の端に、明るい帯が残らないように)
  setStandbyHold(true);
  current = { close, setMode, root, get state() { return { mode: root.dataset.mode, closed, fullscreen: fsActive }; } };

  setMode(root.dataset.mode, { save: false });
  update();
  scheduleTick();
  showControls();
  root.focus({ preventScroll: true });

  // 全画面(ボタンを押した直後の呼び出しなので、ブラウザに許される。Safari は、操作の中で直接呼ぶ必要があるので、非同期にしない)。
  // 使えない・断られたときは、画面いっぱいの表示のまま
  if (fullscreen && typeof root.requestFullscreen === "function" && doc.fullscreenEnabled !== false) {
    let req = null;
    try { req = root.requestFullscreen({ navigationUI: "hide" }); } catch { /* 非対応・断られた */ }
    Promise.resolve(req)
      .then(() => {
        if (closed) { if (doc.fullscreenElement === root && typeof doc.exitFullscreen === "function") doc.exitFullscreen().catch(() => {}); return; }
        if (doc.fullscreenElement === root) fsActive = true;
      })
      .catch(() => { /* 断られた。画面いっぱいの表示で続ける */ });
  }
  return current;
}
