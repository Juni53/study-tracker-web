// Study Tracker v3 - ストップウォッチ/ポモドーロタブ
import { stopwatch, subscribe } from "../store/stopwatch.js";
import { openSaveForm } from "../components/saveForm.js";
import { mountPoints } from "../components/points.js";
import { showAlert, showConfirm } from "../components/dialog.js";
import { reduceMotion, revealX } from "../components/motion.js";
import { morphText } from "../components/morph.js";
import { bindDisclosure } from "../components/disclosure.js";
import { playChime } from "../components/chime.js";
import { prefs, loadPrefs, savePrefs } from "../store/pomodoroPrefs.js";
import { refreshInhibit, refreshNotifyPermission } from "../store/pomodoroAlerts.js";

const p2 = (n) => String(n).padStart(2, "0");

// ポモドーロのリング(ドーナツゲージ): 値が変わるたびに滑らかに動かす。
//  - 毎秒の小さな進みは、1秒かけて一定の速さで(止まらずに進み続けて見える)
//  - リセット・スキップ・フェーズの切り替えなど、大きく変わるときは、イージングで少し速く
//  - 最初の描画では動かさない(タブを開いたときに、0から現在値まで回らないように)
// インライン style で指定するので、属性ではなく CSS の transition が確実に効く。
const RING_JUMP = 20; // これ(全周377のうち約5%)を超える変化は、大きな変化として扱う
function setRingOffset(ring, offset) {
  const prev = ring._offset;
  const value = offset.toFixed(1);
  if (prev === undefined || reduceMotion()) {
    ring.style.transition = "none";
    ring.style.strokeDashoffset = value;
    void ring.getBoundingClientRect(); // 動かさずに反映させてから、transition を戻す
    ring.style.transition = "";
  } else {
    ring.style.transition = Math.abs(offset - prev) > RING_JUMP
      ? "stroke-dashoffset .7s cubic-bezier(.22, 1, .36, 1), stroke .4s ease"
      : "stroke-dashoffset 1s linear, stroke .4s ease";
    ring.style.strokeDashoffset = value;
  }
  ring._offset = offset;
}
const hms = (s) => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
const mmss = (s) => `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
const PHASE_LABEL = { work: "作業中", short_break: "短休憩", long_break: "長休憩" };

let unsubscribe = null;

export function onLeave() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

export async function render(root, api) {
  await loadPrefs(api); // 設定の読み込みは、アプリ起動時に始まっている(ここでは終わりを待つだけ)

  root.innerHTML = `
    <div class="top"><h1>ストップウォッチ</h1><div class="right"><span class="pts mono" id="ptsTop">…</span></div></div>

    <div class="sect">
      <div class="sect-lbl">ストップウォッチ</div>
      <div class="sw-time mono" id="swTime">00:00:00</div>
      <div class="sw-status-row"><span class="dot" id="swDot"></span><span class="lbl3 xf-host xf-inline" id="swStatus"><span class="xf">停止中</span></span></div>
      <div class="sw-btn-row">
        <button class="btn xf-host" id="swToggleBtn"><span class="xf">開始</span></button>
        <button class="btn muted" id="swResetBtn">リセット</button>
        <button class="btn" id="swSaveBtn">保存</button>
      </div>
    </div>

    <div class="sect">
      <div class="pomo-head">
        <div class="t">ポモドーロタイマー</div>
        <div class="pomo-chk-row" id="pomoLinkRow"><span class="pomo-chk" id="pomoChk"><span class="pomo-chk-mark">✓</span></span>ストップウォッチ連動</div>
      </div>
      <div class="ring-area">
        <div class="ring-phase" id="ringPhase"></div>
        <div class="ring-wrap">
          <svg viewBox="0 0 150 150" width="150" height="150">
            <circle cx="75" cy="75" r="60" fill="none" stroke="var(--paper2)" stroke-width="7"/>
            <circle id="ringCircle" cx="75" cy="75" r="60" fill="none" stroke="var(--stamp)" stroke-width="7"
                    stroke-linecap="round" stroke-dasharray="377" stroke-dashoffset="0" transform="rotate(-90 75 75)"/>
          </svg>
          <div class="ring-time mono" id="ringTime"></div>
        </div>
        <div class="cycle-dots" id="cycleDots"></div>
        <div class="sw-btn-row" id="pomoBtnRow" style="margin-top:6px;">
          <button class="btn muted" id="pomoSkipBtn">⏭ スキップ</button>
          <button class="btn xf-host" id="pomoToggleBtn"${stopwatch.pomodoro.linked ? " hidden" : ""}><span class="xf">${stopwatch.pomodoro.running ? "一時停止" : "開始"}</span></button>
          <button class="btn muted" id="pomoResetBtn"${stopwatch.pomodoro.linked ? " hidden" : ""}>リセット</button>
          <span class="pomo-linked-note" id="pomoLinkedNote"${stopwatch.pomodoro.linked ? "" : " hidden"}>ストップウォッチと連動中</span>
        </div>
      </div>

      <div class="adv-toggle pomo-adv-toggle" id="pomoAdvToggle"><span class="arrow">▸</span><span>ポモドーロの設定</span></div>
      <div class="adv-content" id="pomoAdvContent">
        <div class="pomo-cfg">
          <div class="pomo-cfg-cell">作業(分)<b><input class="finput num" id="cfgWork" value="${stopwatch.pomodoro.config.work}"></b></div>
          <div class="pomo-cfg-cell">短休憩(分)<b><input class="finput num" id="cfgShort" value="${stopwatch.pomodoro.config.short_break}"></b></div>
          <div class="pomo-cfg-cell">長休憩(分)<b><input class="finput num" id="cfgLong" value="${stopwatch.pomodoro.config.long_break}"></b></div>
          <div class="pomo-cfg-cell">サイクル数<b><input class="finput num" id="cfgCycles" value="${stopwatch.pomodoro.config.cycles}"></b></div>
        </div>
        <div class="pomo-opts">
          <div class="pomo-chk-row" id="pomoPauseRow"><span class="pomo-chk" id="pomoPauseChk"><span class="pomo-chk-mark">✓</span></span>休憩中はストップウォッチを一時停止</div>
          <div class="pomo-opt-note">連動モードがONのときだけ働きます(OFFのあいだも、設定は変えられます)。</div>
          <div class="pomo-chk-row" data-opt="sound"><span class="pomo-chk"><span class="pomo-chk-mark">✓</span></span>フェーズが切り替わったときに音を鳴らす</div>
          <div class="pomo-vol" id="pomoVolRow">
            <span class="pomo-vol-lbl">音量</span>
            <input type="range" min="0" max="100" step="1" id="pomoVolume" value="${prefs.volume}">
            <span class="pomo-vol-val mono" id="pomoVolVal">${prefs.volume}</span>
          </div>
          <div class="pomo-preview" id="pomoPreview">
            <span class="pomo-vol-lbl">試聴</span>
            <button class="btn muted" data-chime="toBreak">休憩へ</button>
            <button class="btn muted" data-chime="toWork">作業へ</button>
            <button class="btn muted" data-chime="toLong">長休憩へ</button>
          </div>
          <div class="pomo-chk-row" data-opt="desktopNotify"><span class="pomo-chk"><span class="pomo-chk-mark">✓</span></span>デスクトップ通知(アプリが前面にないときだけ)</div>
          <div class="pomo-chk-row" data-opt="idleInhibit"><span class="pomo-chk"><span class="pomo-chk-mark">✓</span></span>計測中は画面の消灯・スリープを防ぐ</div>
        </div>
      </div>
    </div>
  `;

  // 概要のポイント残高
  const home = await api.get_home_data();
  mountPoints(root.querySelector("#ptsTop"), home.points_balance);

  // ── 設定(作業/短休憩/長休憩/サイクル) ──
  const persistPomodoroSettings = () => savePrefs(api);
  bindDisclosure(root.querySelector("#pomoAdvToggle"), root.querySelector("#pomoAdvContent"));

  const cfgEls = {
    work: root.querySelector("#cfgWork"), short_break: root.querySelector("#cfgShort"),
    long_break: root.querySelector("#cfgLong"), cycles: root.querySelector("#cfgCycles"),
  };
  Object.entries(cfgEls).forEach(([key, el]) => {
    el.addEventListener("change", () => {
      const v = Math.max(1, parseInt(el.value, 10) || 1);
      el.value = v;
      stopwatch.configurePomodoro({ [key]: v });
      persistPomodoroSettings();
    });
  });

  // ── 音・通知・アイドル阻害(チェック行。data-opt が prefs のキー) ──
  root.querySelectorAll("[data-opt]").forEach((row) => {
    row.addEventListener("click", () => {
      const key = row.dataset.opt;
      prefs[key] = !prefs[key];
      persistPomodoroSettings();
      if (key === "idleInhibit") refreshInhibit();
      if (key === "desktopNotify" && prefs.desktopNotify) refreshNotifyPermission();
      paint();
      paintPomoButtons();
    });
  });
  // 音量(動かしている間は値と保存だけ。離したとき(change)に保存し、試聴は鳴らす)
  const volEl = root.querySelector("#pomoVolume");
  volEl.addEventListener("input", () => {
    prefs.volume = parseInt(volEl.value, 10) || 0;
    root.querySelector("#pomoVolVal").textContent = String(prefs.volume);
  });
  volEl.addEventListener("change", () => {
    persistPomodoroSettings();
    playChime("toBreak", prefs.volume); // 離したとき、いまの音量で1回鳴らして確かめられる
  });
  // 試聴(音のON/OFFに関わらず鳴らす。実際の切り替えと同じ音)
  root.querySelectorAll("[data-chime]").forEach((b) => b.addEventListener("click", () => playChime(b.dataset.chime, prefs.volume)));

  // ── 連動チェック ──
  const linkRow = root.querySelector("#pomoLinkRow");
  linkRow.addEventListener("click", () => {
    stopwatch.togglePomodoroLink(!stopwatch.pomodoro.linked);
  });

  // ── 休憩中はストップウォッチを一時停止 ──
  // 連動モードのON/OFFに関わらず、いつでも設定を変えられる(OFFのあいだは効かないが、あらかじめ決めておける)
  const pauseRow = root.querySelector("#pomoPauseRow");
  pauseRow.addEventListener("click", () => {
    stopwatch.setPauseOnBreak(!stopwatch.pomodoro.pauseSwOnBreak);
    persistPomodoroSettings();
  });

  // ── ストップウォッチ操作 ──
  // 休憩による自動停止中は、ストップウォッチではなく休憩(ポモドーロ)の一時停止/再開を操作する。
  root.querySelector("#swToggleBtn").addEventListener("click", () => {
    if (stopwatch._autoPausedForBreak) {
      if (stopwatch.pomodoro.running) stopwatch.pomodoroPause(); else stopwatch.pomodoroStart();
      return;
    }
    if (stopwatch.running) stopwatch.pause(); else stopwatch.start();
  });
  root.querySelector("#swResetBtn").addEventListener("click", async () => {
    if (stopwatch.currentSeconds() > 0 &&
        !(await showConfirm("計測中の時間をリセットします。よろしいですか？", { title: "リセットの確認", okText: "リセットする", danger: true }))) return;
    stopwatch.reset();
  });
  root.querySelector("#swSaveBtn").addEventListener("click", async () => {
    const totalSec = stopwatch.currentSeconds();
    if (totalSec < 60) { await showAlert("1分未満は保存できません"); return; }
    const minutes = Math.round(totalSec / 60);
    openSaveForm(api, {
      source: "stopwatch", minutes, dateStr: stopwatch.startDate, startTime: stopwatch.startTime,
      onSaved: () => { stopwatch.finishAndReset(); paint(); },
    });
  });

  // ── ポモドーロの個別操作(非連動時のみ表示) ──
  // ボタン行は毎秒作り直さない(作り直すと、ホバーや遷移のアニメーションが毎秒リセットされてしまう)。
  // 最初に全部置いておき、連動のON/OFFでは、ボタンが「横に伸びながらフェードして現れる/消える」。ラベルはクロスフェード。
  let firstPaint = true;
  const pomoToggleBtn = root.querySelector("#pomoToggleBtn");
  const pomoResetBtn = root.querySelector("#pomoResetBtn");
  const pomoLinkedNote = root.querySelector("#pomoLinkedNote");
  pomoToggleBtn.addEventListener("click", () => {
    if (stopwatch.pomodoro.running) stopwatch.pomodoroPause(); else stopwatch.pomodoroStart();
  });
  pomoResetBtn.addEventListener("click", () => stopwatch.pomodoroReset());
  root.querySelector("#pomoSkipBtn").addEventListener("click", () => stopwatch.skipPhase());

  function paintPomoButtons() {
    const linked = stopwatch.pomodoro.linked;
    revealX(pomoToggleBtn, !linked);
    revealX(pomoResetBtn, !linked);
    revealX(pomoLinkedNote, linked);
    morphText(pomoToggleBtn, stopwatch.pomodoro.running ? "一時停止" : "開始", { animate: !firstPaint });
  }

  paint();
  paintPomoButtons();
  firstPaint = false;
  if (unsubscribe) unsubscribe();
  unsubscribe = subscribe(() => { paint(); paintPomoButtons(); });

  function paint() {
    // ストップウォッチ
    root.querySelector("#swTime").textContent = hms(stopwatch.currentSeconds());
    root.querySelector("#swDot").className = "dot" + (stopwatch.running ? " live" : "");
    const autoPaused = stopwatch._autoPausedForBreak;
    const mo = { animate: !firstPaint }; // タブを開いた最初の描画では動かさない(開いた状態からクロスフェードが始まらないように)
    morphText(root.querySelector("#swStatus"), autoPaused
      ? `休憩中のため自動停止${stopwatch.pomodoro.running ? "" : "・休憩も一時停止中"}`
      : stopwatch.running
      ? `計測中${stopwatch.pomodoro.linked && stopwatch.pomodoro.running ? "・ポモドーロ連動" : ""}`
      : (stopwatch.currentSeconds() > 0 ? "一時停止中" : "停止中"), mo);
    const toggleBtn = root.querySelector("#swToggleBtn");
    morphText(toggleBtn, autoPaused
      ? (stopwatch.pomodoro.running ? "休憩を一時停止" : "休憩を再開")
      : (stopwatch.running ? "一時停止" : "開始"), mo);

    // ポモドーロ連動チェック
    const chk = root.querySelector("#pomoChk");
    chk.classList.toggle("on", stopwatch.pomodoro.linked);

    // 音・通知・アイドル阻害のチェック。音がOFFのときは音量・試聴を薄くして見せる(操作はできる)
    root.querySelectorAll("[data-opt]").forEach((row) => row.querySelector(".pomo-chk").classList.toggle("on", !!prefs[row.dataset.opt]));
    root.querySelector("#pomoVolRow").style.opacity = prefs.sound ? "1" : ".4";
    root.querySelector("#pomoPreview").style.opacity = prefs.sound ? "1" : ".7";

    // 休憩中はストップウォッチを一時停止(連動モードに関わらず、いつでも変更できる)
    root.querySelector("#pomoPauseChk").classList.toggle("on", stopwatch.pomodoro.pauseSwOnBreak);

    // ポモドーロ表示(休憩中はリングを金色に)
    const isBreak = stopwatch.pomodoro.phase !== "work";
    const total = stopwatch.pomodoro.config[stopwatch.pomodoro.phase] * 60;
    const remain = stopwatch.pomodoroRemaining();
    const circumference = 377; // 2πr, r=60
    const offset = total > 0 ? circumference * (1 - remain / total) : 0;
    const ring = root.querySelector("#ringCircle");
    setRingOffset(ring, offset);
    ring.style.stroke = isBreak ? "var(--gold)" : "var(--stamp)";
    root.querySelector("#ringTime").textContent = mmss(remain);
    root.querySelector("#ringPhase").textContent = `${PHASE_LABEL[stopwatch.pomodoro.phase]}・サイクル ${stopwatch.pomodoro.cycle} / ${stopwatch.pomodoro.config.cycles}`;

    const dotsEl = root.querySelector("#cycleDots");
    const n = stopwatch.pomodoro.config.cycles;
    dotsEl.innerHTML = Array.from({ length: n }, (_, i) => {
      const idx = i + 1;
      const cls = idx < stopwatch.pomodoro.cycle ? "done" : idx === stopwatch.pomodoro.cycle ? "cur" : "";
      return `<span class="cyc-dot ${cls}"></span>`;
    }).join("");
  }
}
