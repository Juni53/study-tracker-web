// Study Tracker v3 - ストップウォッチ/ポモドーロの共有ステート
// タブを切り替えても計測を続ける必要があるので、特定のビューではなく
// ここ(アプリ全体で1つだけのストア)が唯一の真実源になる。
// サイドバー下部の表示とストップウォッチタブの両方が、このストアを購読する。

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const listeners = new Set();

export const stopwatch = {
  running: false,
  elapsedSec: 0,      // 一時停止中も含め、これまでに経過した合計秒数
  startDate: null,    // 計測を開始した日(日付をまたいでもこの日付のまま記録する)
  startTime: null,    // 計測を開始した時刻 "HH:MM"(統計の時間帯比率用。startDate と同じタイミングで決まる)
  _tickStartedAt: null, // 直近で再生を始めた瞬間(running中のみ有効)
  _carryMs: 0,          // 秒に満たない端数(ミリ秒)。一時停止・再開をまたいでも失わない(以前は切り捨てていて、停止のたびに最大1秒ずれた)

  _autoPausedForBreak: false, // 休憩中オプションでストップウォッチを自動停止した場合に立てるフラグ

  pomodoro: {
    linked: true,          // ストップウォッチ連動
    pauseSwOnBreak: true,  // 連動時: 休憩中はストップウォッチを自動で一時停止する(既定ON)
    running: false,
    phase: "work",     // "work" | "short_break" | "long_break"
    cycle: 1,
    remainingSec: 25 * 60,
    _carryMs: 0,       // ストップウォッチと同じく、秒に満たない端数を引き継ぐ
    config: { work: 25, short_break: 5, long_break: 15, cycles: 4 },
  },

  configurePomodoro(cfg) {
    this.pomodoro.config = { ...this.pomodoro.config, ...cfg };
    if (!this.pomodoro.running) {
      this.pomodoro.remainingSec = this.pomodoro.config[this.pomodoro.phase === "work" ? "work" : this.pomodoro.phase] * 60;
      this.pomodoro._carryMs = 0;
    }
    notify();
  },

  start() {
    if (this.running) return;
    this.running = true;
    this._tickStartedAt = Date.now();
    if (!this.startDate) { this.startDate = todayIso(); this.startTime = nowHHMM(); }
    if (this.pomodoro.linked) this._startPomodoro();
    notify();
  },

  pause() {
    if (!this.running) return;
    this._commitElapsed();
    this.running = false;
    if (this.pomodoro.linked) this._pausePomodoro();
    notify();
  },

  reset() {
    this.running = false;
    this.elapsedSec = 0;
    this.startDate = null;
    this.startTime = null;
    this._tickStartedAt = null;
    this._carryMs = 0;
    this._autoPausedForBreak = false;
    // 独立モード(非連動)では、ストップウォッチのリセットはポモドーロに一切影響しない
    if (this.pomodoro.linked) this._resetPomodoro();
    notify();
  },

  // 自動一時停止(休憩開始時)。ユーザー操作の pause() と違い、ポモドーロ自体には触れない。
  _autoPauseForBreak() {
    this._commitElapsed();
    this.running = false;
  },
  _autoResumeAfterBreak() {
    this.running = true;
    this._tickStartedAt = Date.now();
  },

  // 保存後の後始末(ストア自体は reset() と同じ)
  finishAndReset() {
    this.reset();
  },

  // 再生を始めてから(端数を含めて)経過したミリ秒。running 中のみ意味がある
  _runMs() {
    return this._carryMs + (Date.now() - this._tickStartedAt);
  },

  currentSeconds() {
    if (!this.running) return this.elapsedSec;
    return this.elapsedSec + Math.floor(this._runMs() / 1000);
  },

  // これまでの分を elapsedSec に確定する。秒に満たない端数は _carryMs に残す(捨てない)
  _commitElapsed() {
    if (this.running) {
      const ms = this._runMs();
      this.elapsedSec += Math.floor(ms / 1000);
      this._carryMs = ms % 1000;
      this._tickStartedAt = Date.now();
    }
  },

  // ── ポモドーロ(連動時はここから呼ばれる。非連動時は下の公開メソッドを直接使う) ──
  _startPomodoro() {
    this.pomodoro.running = true;
    this.pomodoro._tickStartedAt = Date.now();
  },
  _pausePomodoro() {
    const po = this.pomodoro;
    if (po.running) {
      const ms = po._carryMs + (Date.now() - po._tickStartedAt);
      po.remainingSec = Math.max(0, po.remainingSec - Math.floor(ms / 1000));
      po._carryMs = po.remainingSec > 0 ? ms % 1000 : 0;
    }
    po.running = false;
  },
  _resetPomodoro() {
    this.pomodoro._carryMs = 0;
    this.pomodoro.running = false;
    this.pomodoro.phase = "work";
    this.pomodoro.cycle = 1;
    this.pomodoro.remainingSec = this.pomodoro.config.work * 60;
  },
  togglePomodoroLink(linked) {
    this.pomodoro.linked = linked;
    if (linked && this.running && !this.pomodoro.running) this._startPomodoro();
    if (!linked) this._pausePomodoro();
    notify();
  },
  setPauseOnBreak(v) {
    this.pomodoro.pauseSwOnBreak = v;
    notify();
  },
  // 非連動時、手動でポモドーロだけ開始/一時停止したい場合に使う
  pomodoroStart() { this._startPomodoro(); notify(); },
  pomodoroPause() { this._pausePomodoro(); notify(); },
  pomodoroReset() { this._resetPomodoro(); notify(); },

  _advancePhase() {
    const cfg = this.pomodoro.config;
    this.pomodoro._carryMs = 0; // 新しいフェーズは、端数なしで始まる
    if (this.pomodoro.phase === "work") {
      const isLong = this.pomodoro.cycle % cfg.cycles === 0;
      this.pomodoro.phase = isLong ? "long_break" : "short_break";
      this.pomodoro.remainingSec = (isLong ? cfg.long_break : cfg.short_break) * 60;
    } else {
      if (this.pomodoro.phase === "long_break") this.pomodoro.cycle = 1;
      else this.pomodoro.cycle += 1;
      this.pomodoro.phase = "work";
      this.pomodoro.remainingSec = cfg.work * 60;
    }
  },

  // フェーズの切り替わり(work⇔break)に伴う、休憩中の自動一時停止/自動再開の共通処理。
  // 「残り時間が0になった時」と「スキップボタン」の両方から呼ぶ。
  _handlePhaseBoundary(wasBreak, nowBreak) {
    const po = this.pomodoro;
    if (po.linked && !wasBreak && nowBreak && po.pauseSwOnBreak && this.running) {
      this._autoPauseForBreak();
      this._autoPausedForBreak = true;
    } else if (po.linked && wasBreak && !nowBreak && this._autoPausedForBreak) {
      this._autoResumeAfterBreak();
      this._autoPausedForBreak = false;
    }
  },

  // 現在のフェーズ(作業/休憩)を、残り時間を切り上げて次に進める。連動/独立どちらでも使える。
  skipPhase() {
    const wasRunning = this.pomodoro.running;
    if (wasRunning) this._pausePomodoro();
    const wasBreak = this.pomodoro.phase !== "work";
    const from = this.pomodoro.phase;
    this._advancePhase();
    const nowBreak = this.pomodoro.phase !== "work";
    this._handlePhaseBoundary(wasBreak, nowBreak);
    if (wasRunning) this._startPomodoro();
    emitPhaseChange({ from, to: this.pomodoro.phase, auto: false });
    notify();
  },

  pomodoroRemaining() {
    const po = this.pomodoro;
    if (!po.running) return po.remainingSec;
    return Math.max(0, po.remainingSec - Math.floor((po._carryMs + (Date.now() - po._tickStartedAt)) / 1000));
  },
};

// フェーズが切り替わったときの通知(音・デスクトップ通知用)。時間切れの自動切替と、スキップの両方で呼ぶ。
// 戻り値の関数で購読を解除できる。{ from, to, auto }(auto = 時間切れで自動的に切り替わった)
const phaseListeners = new Set();
export function onPhaseChange(fn) {
  phaseListeners.add(fn);
  return () => phaseListeners.delete(fn);
}
function emitPhaseChange(ev) {
  phaseListeners.forEach((fn) => {
    try { fn(ev); } catch (e) { console.error(e); } // 通知側の不具合でタイマーを止めない
  });
}

function notify() {
  try {
    listeners.forEach((fn) => fn());
  } finally {
    scheduleTick(); // 状態が変わるたびに、次のティックを予約し直す
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── ティック(タブに関わらず、アプリが起動している間ずっと動く) ──
// 以前は setInterval(…, 1000) だった。実際の間隔は数ミリ秒ぶれるので、表示は「開始からの経過秒の切り捨て」のため、
// ティックが秒の境界ぎりぎりに来ると、同じ秒が2回表示されたり(止まって見える)、1秒飛んだり(飛んで見える)していた
// (内部の時間は正確なので、表示だけの問題)。
// いまは、動いているタイマーが「次に表示が変わる秒の境界」を計算して、その直後に1回だけ予約する。
// タイマーが少し遅れても、表示は常に時刻から計算するので、ずれが次のティックに持ち越されない。
const TICK_MARGIN_MS = 2; // 境界のわずか後に、確実に秒をまたいだ状態で呼ばれるようにする
let tickTimer = null;

function msUntilNextSecond(runMs) {
  return 1000 - (runMs % 1000);
}

function scheduleTick() {
  clearTimeout(tickTimer);
  let wait = 1000; // 何も動いていないときの、念のための見回り間隔
  if (stopwatch.running) wait = Math.min(wait, msUntilNextSecond(stopwatch._runMs()));
  if (stopwatch.pomodoro.running) {
    const po = stopwatch.pomodoro;
    wait = Math.min(wait, msUntilNextSecond(po._carryMs + (Date.now() - po._tickStartedAt)));
  }
  tickTimer = setTimeout(tick, wait + TICK_MARGIN_MS);
  if (typeof tickTimer === "object" && tickTimer.unref) tickTimer.unref(); // Node(テスト)では、このタイマーだけでプロセスを生かし続けない。ブラウザでは数値なので何もしない
}

function tick() {
  const po = stopwatch.pomodoro;
  if (po.running && stopwatch.pomodoroRemaining() <= 0) {
    // フェーズの終わり。タイマーの遅れで終了時刻を過ぎていた分は、次のフェーズの経過として引き継ぐ(1周ごとにずれが溜まらない)
    const overshootMs = Math.max(0, po._carryMs + (Date.now() - po._tickStartedAt) - po.remainingSec * 1000);
    po.remainingSec = 0;
    stopwatch._pausePomodoro();
    const wasBreak = po.phase !== "work";
    const from = po.phase;
    stopwatch._advancePhase();
    const nowBreak = po.phase !== "work";
    stopwatch._handlePhaseBoundary(wasBreak, nowBreak);
    // PC のスリープなどで複数のフェーズぶん遅れて戻ってきても、1回の tick で進めるのは1フェーズだけなので、通知も1回だけ
    emitPhaseChange({ from, to: po.phase, auto: true });

    // この if ブロックに入った時点で、直前までポモドーロは動いていた(ユーザーが
    // 一時停止したのではない)ので、ストップウォッチ側をどう扱ったかに関わらず、
    // ポモドーロ自体は次のフェーズへそのまま動き続ける。
    stopwatch._startPomodoro();
    po._tickStartedAt -= Math.min(overshootMs, 1000);
  }
  if (stopwatch.running || po.running) notify(); // notify が次のティックも予約する
  else scheduleTick();
}

scheduleTick();
