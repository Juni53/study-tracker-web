// 待機画面(全画面): components/standby.js・css/standby.css・store の設定と画面消灯防止。
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { setupDom, tick } from "./_dom.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });   // 動きを減らす設定 = アニメーションなしで書き換える
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const { stopwatch } = await import("../ui/js/store/stopwatch.js");
const { prefs, loadPrefs, savePrefs } = await import("../ui/js/store/pomodoroPrefs.js");
const { startAlerts, setStandbyHold } = await import("../ui/js/store/pomodoroAlerts.js");
const { openStandby, closeStandby, isStandbyOpen, driftPoint, DRIFT_STEP_MS, DRIFT_AMP, IDLE_HIDE_MS, STANDBY_MODES } = await import("../ui/js/components/standby.js");
const { hms, mmss, swStatusLabel, ringOffset, startLabel } = await import("../ui/js/components/timeFormat.js");

// ── 偽の API(画面消灯防止・設定の保存の呼び出しを記録する) ──
const calls = { inhibit: [], settings: [] };
const api = {
  set_idle_inhibit: async (on) => { calls.inhibit.push(on); return { ok: true }; },
  update_setting: async (k, v) => { calls.settings.push([k, structuredClone(v)]); return { ok: true }; },
  notify_desktop: async () => ({}), request_notification_permission: async () => "granted",
  get_settings: async () => ({}),
};
startAlerts(api);

const $ = (id) => document.getElementById(id);
const overlay = () => document.querySelector(".standby");
const reset = () => {
  closeStandby();
  stopwatch.reset(); stopwatch.pomodoroReset();
  stopwatch.configurePomodoro({ work: 25, short_break: 5, long_break: 15, cycles: 4 });
  stopwatch.pomodoro.linked = true;
  prefs.standbyMode = "normal"; prefs.idleInhibit = false;
  calls.inhibit.length = 0; calls.settings.length = 0;
  setStandbyHold(false); calls.inhibit.length = 0;
  document.getElementById("app").inert = false;
  mock.timers.reset();
};
const key = (target, k, opts = {}) => target.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts }));
const restoreClock = setClock(() => new Date(2026, 10, 5, 23, 7, 0));

test("開く: 画面いっぱいのダイアログ(role・aria-modal・名前)。後ろの画面(#app)は、操作・読み上げの対象外。フォーカスは、待機画面へ", () => {
  reset();
  const s = openStandby(api);
  const el = overlay();
  assert.ok(el && isStandbyOpen());
  assert.equal(el.getAttribute("role"), "dialog");
  assert.equal(el.getAttribute("aria-modal"), "true");
  assert.equal(el.getAttribute("aria-label"), "待機画面");
  assert.equal(document.getElementById("app").inert, true);
  assert.ok(document.documentElement.classList.contains("standby-open"), "後ろのページのスクロールバーを隠していない");
  assert.equal(document.activeElement, el);
  assert.equal(el.dataset.mode, "normal", "既定は、テーマ色");
  assert.equal(openStandby(api), s, "2 つ目は開かない(同じものを返す)");
  assert.equal(document.querySelectorAll(".standby").length, 1);
  s.close();
});

test("表示内容: 現在時刻・ストップウォッチ(状態・時間・開始時刻)・ポモドーロ(残り・フェーズ・サイクル・リング)が、ストアのとおりに出る", () => {
  reset();
  stopwatch.elapsedSec = 3725; stopwatch.startDate = "2026-11-05"; stopwatch.startTime = "21:50";
  stopwatch.configurePomodoro({});                                   // 通知を出して、状態を反映
  openStandby(api);
  assert.equal($("sbClock").textContent, "23:07", "現在時刻が、共通の時計から出ていない");
  assert.equal($("sbTime").textContent, "01:02:05");
  assert.equal($("sbStatus").textContent, "一時停止中");
  assert.equal($("sbStart").textContent, "開始 21:50");
  assert.equal($("sbRemain").textContent, "25:00");
  assert.equal($("sbPhase").textContent, "作業中");
  assert.equal($("sbCycle").textContent, "サイクル 1 / 4");
  assert.equal(document.querySelectorAll("#sbDots .sb-cdot").length, 4);
  assert.deepEqual([...document.querySelectorAll("#sbDots .sb-cdot")].map((d) => d.className.replace("sb-cdot", "").trim()), ["cur", "", "", ""]);
  assert.equal($("sbPomo").dataset.phase, "work");
  assert.equal($("sbPomo").dataset.running, "false");
  assert.equal($("sbRing").style.strokeDashoffset, "0.0");
  // ストアが変わると、すぐ追従する(購読)
  stopwatch.pomodoro.phase = "short_break"; stopwatch.pomodoro.remainingSec = 150; stopwatch.pomodoro.cycle = 2;
  stopwatch.setPauseOnBreak(true);                                    // 通知だけを出す(configurePomodoro は、停止中だと残り時間を設定値に戻す)
  assert.equal($("sbRemain").textContent, "02:30");
  assert.equal($("sbPhase").textContent, "短休憩");
  assert.equal($("sbCycle").textContent, "サイクル 2 / 4");
  assert.equal($("sbPomo").dataset.phase, "break");
  assert.equal($("sbRing").style.strokeDashoffset, (377 * 0.5).toFixed(1), "リングの欠けが、残り時間(150/300)に合っていない");
  assert.deepEqual([...document.querySelectorAll("#sbDots .sb-cdot")].map((d) => d.className.replace("sb-cdot", "").trim()), ["done", "cur", "", ""]);
  closeStandby();
});

test("計測中: 状態は「計測中」、点は点灯。ポモドーロも動いていれば、通常の明るさ(止まっているときは、抑える)", () => {
  reset();
  openStandby(api);
  assert.equal($("sbPomo").dataset.running, "false");
  stopwatch.start();                                                  // 連動 ON → ポモドーロも動く
  assert.equal($("sbStatus").textContent, "計測中・ポモドーロ連動");
  assert.ok($("sbDot").classList.contains("live"));
  assert.equal($("sbPomo").dataset.running, "true");
  assert.match($("sbStart").textContent, /^開始 \d\d:\d\d$/);
  stopwatch.pause();
  assert.equal($("sbStatus").textContent, swStatusLabel(), "一時停止したのに、状態の文字が変わらない");
  assert.notEqual($("sbStatus").textContent.slice(0, 3), "計測中");
  assert.ok(!$("sbDot").classList.contains("live"));
  closeStandby();
});

test("文字は、変わったときだけ書き換える(毎秒、同じ文字を書き直さない)", () => {
  reset();
  openStandby(api);
  const node = $("sbTime").firstChild;
  stopwatch.configurePomodoro({});
  assert.equal($("sbTime").firstChild, node, "同じ文字なのに、書き直した");
  closeStandby();
});

test("表示は 2 種類(通常 / 有機EL)。切り替えると、data-mode・押下状態が変わり、設定に保存される(次回も使う)", async () => {
  reset();
  assert.deepEqual(STANDBY_MODES.map((m) => m.key), ["normal", "oled"]);
  openStandby(api);
  const btn = (m) => document.querySelector(`[data-sb-mode="${m}"]`);
  assert.deepEqual([btn("normal").getAttribute("aria-pressed"), btn("oled").getAttribute("aria-pressed")], ["true", "false"]);
  btn("oled").click();
  assert.equal(overlay().dataset.mode, "oled");
  assert.deepEqual([btn("normal").getAttribute("aria-pressed"), btn("oled").getAttribute("aria-pressed")], ["false", "true"]);
  assert.equal(prefs.standbyMode, "oled");
  await tick();
  assert.equal(calls.settings.length, 1);
  assert.equal(calls.settings[0][0], "pomodoro");
  assert.equal(calls.settings[0][1].standby_mode, "oled");
  btn("oled").click();                                                // 同じ表示を押し直しても、保存し直さない
  await tick();
  assert.equal(calls.settings.length, 1);
  closeStandby();
  openStandby(api);                                                   // 次に開いたとき、前回の表示で開く
  assert.equal(overlay().dataset.mode, "oled");
  assert.equal(document.querySelector('[data-sb-mode="oled"]').getAttribute("aria-pressed"), "true");
  closeStandby();
});

test("設定: standby_mode は、読み込み・保存される。知らない値は無視。ポモドーロの設定(cfg)に、混ざらない", async () => {
  reset();
  // loadPrefs は、アプリ起動時の 1 回だけ読む仕組みなので、新しい読み込みは、別の api で別モジュールのコピーを使わず、中身を直接確かめる
  const src = read("ui/js/store/pomodoroPrefs.js");
  assert.match(src, /const \{ pause_sw_on_break, sound, volume, desktop_notify, idle_inhibit, standby_mode, \.\.\.cfg \} = p;/, "standby_mode が、cfg(ポモドーロの設定)に混ざる");
  assert.match(src, /STANDBY_MODE_KEYS\.includes\(standby_mode\)/);
  prefs.standbyMode = "oled";
  await savePrefs(api);
  const saved = calls.settings.at(-1)[1];
  assert.equal(saved.standby_mode, "oled");
  assert.deepEqual(Object.keys(saved).sort(), ["cycles", "desktop_notify", "idle_inhibit", "long_break", "pause_sw_on_break", "short_break", "sound", "standby_mode", "volume", "work"]);
  void loadPrefs;
  // 既定の設定(defaults.js)には、入れない(Python 版の設定に無い項目を、既定値で増やさない)
  assert.doesNotMatch(read("ui/js/core/defaults.js").replace(/\/\/.*$/gm, ""), /standby_mode/);
});

test("設定の読み込み: standby_mode が読まれる。知らない値・無い場合は「通常」のまま。ポモドーロの設定(cfg)に混ざらない", async () => {
  reset();
  const fresh = async (pomodoro, tag) => {
    const mod = await import(`../ui/js/store/pomodoroPrefs.js?${tag}`);      // 「1 回だけ読む」ので、別のコピーで確かめる(ストップウォッチのストアは共通)
    mod.prefs.standbyMode = "normal";
    await mod.loadPrefs({ get_settings: async () => ({ pomodoro }) });
    return mod.prefs.standbyMode;
  };
  assert.equal(await fresh({ work: 30, standby_mode: "oled" }, "a"), "oled");
  assert.equal(stopwatch.pomodoro.config.work, 30, "ほかのポモドーロの設定も、読まれる");
  assert.ok(!("standby_mode" in stopwatch.pomodoro.config), "standby_mode が、ポモドーロの設定に混ざった");
  assert.equal(await fresh({ standby_mode: "normal" }, "b"), "normal");
  assert.equal(await fresh({ standby_mode: "rainbow" }, "c"), "normal", "知らない値を、そのまま使った");
  assert.equal(await fresh({ standby_mode: 1 }, "d"), "normal");
  assert.equal(await fresh({ work: 25 }, "e"), "normal", "保存されていないときは、通常");
  stopwatch.configurePomodoro({ work: 25 });
});

test("有機EL: 表示が、ゆっくり動く(40 秒ごとに行き先が変わる。範囲は ±3)。通常では動かない。切り替えで止まる", () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  openStandby(api);
  const stage = document.querySelector(".sb-stage");
  const pos = () => [stage.style.getPropertyValue("--sb-dx"), stage.style.getPropertyValue("--sb-dy")];
  assert.deepEqual(pos(), ["0", "0"], "通常では、動かない");
  mock.timers.tick(DRIFT_STEP_MS * 3);
  assert.deepEqual(pos(), ["0", "0"]);
  document.querySelector('[data-sb-mode="oled"]').click();
  const idxNow = Math.floor(Date.now() / DRIFT_STEP_MS);
  const candidates = [idxNow, idxNow - 1, idxNow + 1].map((i) => JSON.stringify([String(driftPoint(i).x), String(driftPoint(i).y)]));
  assert.ok(candidates.includes(JSON.stringify(pos())), `開いた位置が、道筋(driftPoint)の上にない: ${pos()}`);
  const seen = new Set([JSON.stringify(pos())]);
  for (let i = 0; i < 12; i++) {
    mock.timers.tick(DRIFT_STEP_MS);
    const [dx, dy] = pos().map(Number);
    assert.ok(Math.abs(dx) <= DRIFT_AMP && Math.abs(dy) <= DRIFT_AMP, `範囲(±${DRIFT_AMP})を出た: ${dx}, ${dy}`);
    seen.add(JSON.stringify(pos()));
  }
  assert.ok(seen.size >= 10, `動きが少ない(同じ位置のくり返し): ${seen.size}`);
  document.querySelector('[data-sb-mode="normal"]').click();         // 通常に戻すと、止まって、中心へ
  assert.deepEqual(pos(), ["0", "0"]);
  mock.timers.tick(DRIFT_STEP_MS * 3);
  assert.deepEqual(pos(), ["0", "0"], "通常に戻したのに、動き続けている");
  closeStandby();
  mock.timers.tick(DRIFT_STEP_MS * 3);                                // 閉じたあと、タイマーが残っていない(例外も出ない)
});

test("driftPoint: 中心から ±amp の範囲で、毎回違う場所。同じ番号なら同じ場所(決まった道筋)", () => {
  const pts = Array.from({ length: 500 }, (_, i) => driftPoint(i));
  for (const p of pts) assert.ok(Math.abs(p.x) <= DRIFT_AMP && Math.abs(p.y) <= DRIFT_AMP);
  assert.equal(new Set(pts.map((p) => `${p.x},${p.y}`)).size, 500, "同じ場所をくり返している");
  assert.deepEqual(driftPoint(7), driftPoint(7));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  assert.ok(Math.max(...xs) > DRIFT_AMP * 0.9 && Math.min(...xs) < -DRIFT_AMP * 0.9, "横に、範囲いっぱいまで動いていない");
  assert.ok(Math.max(...ys) > DRIFT_AMP * 0.9 && Math.min(...ys) < -DRIFT_AMP * 0.9, "縦に、範囲いっぱいまで動いていない");
  assert.ok(DRIFT_AMP > 0 && DRIFT_AMP <= 4, "「少し」動く範囲");
});

test("操作ボタンは、4 秒操作がないと隠れ、触れる・動かす・キーで、また出る。キーボードで操作中は、隠れない", () => {
  reset();
  mock.timers.enable({ apis: ["setTimeout"] });
  openStandby(api);
  const el = overlay();
  assert.ok(!el.classList.contains("sb-idle"), "開いた直後は、出ている");
  mock.timers.tick(IDLE_HIDE_MS - 1);
  assert.ok(!el.classList.contains("sb-idle"));
  mock.timers.tick(1);
  assert.ok(el.classList.contains("sb-idle"), "4 秒たっても、隠れない");
  el.dispatchEvent(new w.Event("pointermove", { bubbles: true }));
  assert.ok(!el.classList.contains("sb-idle"), "動かしても、出ない");
  mock.timers.tick(IDLE_HIDE_MS);
  assert.ok(el.classList.contains("sb-idle"));
  key(el, "Shift");                                                    // キー操作でも出る
  assert.ok(!el.classList.contains("sb-idle"));
  // キーボードで操作中(ボタンにフォーカス)は、隠さない
  $("sbClose").focus();
  mock.timers.tick(IDLE_HIDE_MS * 2);
  assert.ok(!el.classList.contains("sb-idle"), "ボタンにフォーカスがあるのに、隠れた");
  closeStandby();
});

test("閉じる: 「閉じる」ボタン / Esc / 全画面を抜けたとき。後ろの画面・フォーカス・画面消灯防止が元に戻る", async () => {
  reset();
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  openStandby(api, { opener });
  $("sbClose").click();
  assert.ok(!overlay() && !isStandbyOpen());
  assert.equal(document.getElementById("app").inert, false);
  assert.ok(!document.documentElement.classList.contains("standby-open"), "閉じたのに、ページのスクロールが止まったまま");
  assert.equal(document.activeElement, opener, "閉じたあと、開いたボタンにフォーカスが戻らない");
  openStandby(api, { opener });
  key(overlay(), "Escape");
  assert.ok(!overlay(), "Esc で閉じない");
  openStandby(api, { opener });
  key($("sbClose"), "Escape");                                         // ボタンにフォーカスがあるときの Esc も
  assert.ok(!overlay());
  opener.remove();
  openStandby(api, { opener });                                         // 開いたボタンが消えていても、閉じられる
  closeStandby();
  assert.ok(!overlay());
  await tick();
});

test("フォーカスは、待機画面の中に閉じ込める(Tab・Shift+Tab で、ボタンの間を回る)", () => {
  reset();
  openStandby(api);
  const buttons = [...overlay().querySelectorAll("button")];
  assert.equal(buttons.length, 3);
  buttons.at(-1).focus();
  key(buttons.at(-1), "Tab");
  assert.equal(document.activeElement, buttons[0], "最後のボタンから Tab で、最初に戻らない");
  key(buttons[0], "Tab", { shiftKey: true });
  assert.equal(document.activeElement, buttons.at(-1), "最初のボタンから Shift+Tab で、最後に回らない");
  overlay().focus();
  key(overlay(), "Tab", { shiftKey: true });
  assert.equal(document.activeElement, buttons.at(-1));
  closeStandby();
});

// ── 全画面 ──
function fakeFullscreen({ reject = false, delayed = false } = {}) {
  let fsEl = null;
  const log = { requests: [], exits: 0 };
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fsEl });
  Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
  document.exitFullscreen = () => { log.exits++; fsEl = null; return Promise.resolve(); };
  w.HTMLElement.prototype.requestFullscreen = function (opts) {
    log.requests.push(opts);
    if (reject) return Promise.reject(new Error("NotAllowed"));
    if (delayed) return new Promise((resolve) => setTimeout(() => { fsEl = this; resolve(); }, 5));   // 本物のブラウザのように、少しあとで全画面になる
    fsEl = this;
    return Promise.resolve();
  };
  log.leave = () => { fsEl = null; document.dispatchEvent(new w.Event("fullscreenchange")); };
  log.restore = () => { delete w.HTMLElement.prototype.requestFullscreen; delete document.exitFullscreen; delete document.fullscreenElement; delete document.fullscreenEnabled; };
  return log;
}

test("全画面: 開くと本物の全画面にする(ナビゲーションは隠す)。Esc などで全画面を抜けたら、待機画面も閉じる。閉じたら全画面も抜ける", async () => {
  reset();
  const fs = fakeFullscreen();
  try {
    const s = openStandby(api);
    assert.deepEqual(fs.requests, [{ navigationUI: "hide" }]);
    await tick();
    assert.equal(s.state.fullscreen, true);
    fs.leave();                                                         // ブラウザが Esc で全画面を抜けた
    assert.ok(!overlay(), "全画面を抜けたのに、待機画面が残っている");
    openStandby(api); await tick();
    closeStandby();                                                    // 「閉じる」で閉じたら、全画面も抜ける
    assert.equal(fs.exits, 1, "閉じたのに、全画面のまま");
  } finally { fs.restore(); }
});

test("全画面が使えない・断られた(iPhone の Safari など)ときは、画面いっぱいの表示のまま使える", async () => {
  reset();
  const none = openStandby(api);                                       // requestFullscreen が無い環境(jsdom)
  assert.ok(overlay() && none.state.fullscreen === false);
  closeStandby();
  const fs = fakeFullscreen({ reject: true });
  try {
    openStandby(api); await tick(); await tick();
    assert.ok(overlay(), "断られたのに、閉じてしまった");
    assert.equal(fs.requests.length, 1);
    document.dispatchEvent(new w.Event("fullscreenchange"));          // 全画面でなかったので、この通知では閉じない
    assert.ok(overlay());
    closeStandby();
    openStandby(api, { fullscreen: false });
    assert.equal(fs.requests.length, 1, "fullscreen:false なのに、全画面を求めた");
    closeStandby();
  } finally { fs.restore(); }
});

test("全画面の要求の途中で閉じても、あとから全画面だけが残らない(全画面になるのが、閉じたあとでも)", async () => {
  reset();
  const fs = fakeFullscreen({ delayed: true });
  try {
    openStandby(api);
    closeStandby();                                                    // 要求の結果が返る前に閉じる
    await new Promise((r) => setTimeout(r, 30));                       // ブラウザが、閉じたあとで全画面にした
    assert.ok(!overlay());
    assert.equal(document.fullscreenElement, null, "閉じたあとに、全画面が残った");
    assert.equal(fs.exits, 1);
  } finally { fs.restore(); }
  // 遅れて全画面になる場合でも、ふつうに使える(開く → 全画面になる → 抜けたら閉じる)
  const fs2 = fakeFullscreen({ delayed: true });
  try {
    const s = openStandby(api);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(s.state.fullscreen, true);
    fs2.leave();
    assert.ok(!overlay());
  } finally { fs2.restore(); }
});

// ── 画面の消灯防止 ──
test("開いている間は、設定に関わらず、画面の消灯を防ぐ。閉じたら元に戻る(設定が ON で計測中なら、防いだまま)", async () => {
  reset();
  openStandby(api);
  assert.deepEqual(calls.inhibit, [true]);
  closeStandby();
  assert.deepEqual(calls.inhibit, [true, false]);
  // 設定ON + 計測中: 閉じても、防ぎ続ける(false を送らない)
  reset();
  prefs.idleInhibit = true;
  stopwatch.start(); await tick();
  assert.deepEqual(calls.inhibit, [true], "計測中は、設定どおり防ぐ");
  openStandby(api);
  closeStandby();
  assert.deepEqual(calls.inhibit, [true], "待機画面を閉じたら、設定で防いでいる分まで止めてしまった");
  stopwatch.pause(); await tick();
  assert.deepEqual(calls.inhibit, [true, false]);
});

test("フェーズが切り替わったら、読み上げ用に知らせる(目に見えない)", () => {
  reset();
  openStandby(api);
  stopwatch.skipPhase();
  assert.equal($("sbAnnounce").textContent, "短休憩に切り替わりました");
  assert.equal($("sbAnnounce").getAttribute("aria-live"), "polite");
  assert.ok($("sbAnnounce").classList.contains("sr-only"));
  closeStandby();
});

// ── ストップウォッチのタブ ──
test("ストップウォッチのタブの「待機画面(全画面)」ボタンで開き、閉じると、ボタンにフォーカスが戻る", async () => {
  reset();
  const store = await openStorage({ indexedDB: new IDBFactory() });
  const real = new Api(store);
  const proxy = new Proxy({}, { get: (_, m) => (m in api ? api[m] : async (...a) => structuredClone(await real[m](...structuredClone(a)))) });
  const root = document.createElement("div");
  document.body.appendChild(root);
  const view = await import("../ui/js/views/timer.js");
  await view.render(root, proxy);
  const btn = root.querySelector("#standbyBtn");
  assert.ok(btn);
  assert.match(btn.textContent, /待機画面/);
  assert.equal(btn.getAttribute("aria-haspopup"), "dialog");
  btn.focus();
  btn.click();
  assert.ok(overlay());
  key(overlay(), "Escape");
  assert.ok(!overlay());
  assert.equal(document.activeElement, btn);
  view.onLeave();
  root.remove();
});

// ── 表示用の部品(ストップウォッチのタブと共通) ──
test("timeFormat: 時間の文字・状態の文言・リングの欠け・開始時刻", () => {
  assert.equal(hms(0), "00:00:00"); assert.equal(hms(3725), "01:02:05"); assert.equal(hms(86399), "23:59:59"); assert.equal(hms(360000), "100:00:00");
  assert.equal(mmss(0), "00:00"); assert.equal(mmss(1500), "25:00"); assert.equal(mmss(61), "01:01");
  const sw = { running: false, _autoPausedForBreak: false, currentSeconds: () => 0, pomodoro: { running: false, linked: true } };
  assert.equal(swStatusLabel(sw), "停止中");
  assert.equal(swStatusLabel({ ...sw, currentSeconds: () => 5 }), "一時停止中");
  assert.equal(swStatusLabel({ ...sw, running: true, pomodoro: { running: true, linked: true } }), "計測中・ポモドーロ連動");
  assert.equal(swStatusLabel({ ...sw, running: true, pomodoro: { running: true, linked: false } }), "計測中");
  assert.equal(swStatusLabel({ ...sw, _autoPausedForBreak: true, pomodoro: { running: false, linked: true } }), "休憩中のため自動停止・休憩も一時停止中");
  assert.equal(swStatusLabel({ ...sw, _autoPausedForBreak: true, pomodoro: { running: true, linked: true } }), "休憩中のため自動停止");
  const po = { phase: "work", config: { work: 25, short_break: 5 } };
  assert.equal(ringOffset(po, 1500), 0); assert.equal(ringOffset(po, 750), 188.5); assert.equal(ringOffset(po, 0), 377);
  assert.equal(ringOffset({ phase: "short_break", config: { short_break: 0 } }, 0), 0, "長さ 0 でも、割り算で壊れない");
  assert.equal(startLabel({ startDate: null, startTime: null }, null), "");
  assert.equal(startLabel({ startDate: "2026-11-05", startTime: "21:50" }, null), "開始 21:50");
  assert.equal(startLabel({ startDate: "2026-11-04", startTime: "23:50" }, { startDate: "2026-11-04" }), "11/04 23:50 開始");
});

// ── CSS の取り決め ──
test("CSS: 有機ELは背景が真っ黒(#000)で、文字は真っ白にしない・線は細い。通常は、テーマ色(変数)を使う", () => {
  const css = read("ui/css/standby.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const oled = css.match(/\.standby\[data-mode="oled"\]\{([^}]*)\}/)[1];
  assert.match(oled, /--sb-bg:#000;/, "背景が、真っ黒(0)でない");
  const ink = oled.match(/--sb-ink:#([0-9a-f]{6});/i)[1];
  const sub = oled.match(/--sb-sub:#([0-9a-f]{6});/i)[1];
  for (const hex of [ink, sub]) for (let i = 0; i < 6; i += 2) assert.ok(parseInt(hex.slice(i, i + 2), 16) <= 0xc8, `有機ELの文字が明るすぎる(#${hex})`);
  assert.ok(parseInt(ink.slice(0, 2), 16) >= 0x80, "文字が暗すぎて読めない");
  const normal = css.match(/\.standby\[data-mode="normal"\]\{([^}]*)\}/)[1];
  for (const v of ["--paper", "--ink", "--ink-sub", "--stamp", "--gold"]) assert.match(normal, new RegExp(`var\\(${v}\\)`), `通常の表示が、テーマ色 ${v} を使っていない`);
  assert.doesNotMatch(normal, /#[0-9a-f]{3,6}/i, "通常の表示に、固定の色がある(テーマに従わない)");
  const w = (m) => Number(m.match(/--sb-ring-w:(\d+)/)[1]);
  assert.ok(w(oled) < w(normal), "有機ELの線が、通常より細くない");
  assert.doesNotMatch(css, /box-shadow|text-shadow|linear-gradient|radial-gradient/, "発光する・広い明るい面になる装飾がある");
  assert.match(css, /\.sb-btn\{[^}]*background:transparent/, "ボタンが、面を塗っている");
});

test("CSS: 動く範囲は、外側の余白に収まる。移動は 40 秒で一定の速さ。「動きを減らす」設定では、滑らかな移動をやめる。位置は、JS の定数と合っている", () => {
  const css = read("ui/css/standby.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const pad = Number(css.match(/\.sb-stage\{[^}]*padding:(\d+)vmin/)[1]);
  assert.ok(pad >= DRIFT_AMP * 2, `余白(${pad}vmin)が、動く範囲(±${DRIFT_AMP})に対して足りない: 動くと、画面の外へはみ出す`);
  assert.match(css, /transform:translate\(calc\(var\(--sb-dx, 0\) \* 1vmin\), calc\(var\(--sb-dy, 0\) \* 1vmin\)\);/);
  assert.match(css, new RegExp(`transition:transform ${DRIFT_STEP_MS / 1000}s linear;`), "移動の長さが、JS の DRIFT_STEP_MS と違う");
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\s*\.standby\[data-mode="oled"\] \.sb-stage\{transition:none;\}/);
  assert.doesNotMatch(css.match(/\.standby\[data-mode="normal"\][^{]*\{/g).join(""), /sb-stage/, "通常の表示が動く");
  assert.doesNotMatch(css.split('[data-mode="oled"] .sb-stage')[0].slice(-200), /transform/);   // 動くのは、有機ELだけ
});

test("CSS: 全画面・使いやすさの取り決め(画面いっぱい・右下のお知らせより前・dvh・横長で 2 列・ボタンは自動で消える・フォーカスが見える)", () => {
  const css = read("ui/css/standby.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const components = read("ui/css/components.css");
  assert.match(css, /\.standby\{[^}]*position:fixed; inset:0;/);
  const z = Number(css.match(/\.standby\{[^}]*z-index:(\d+)/)[1]);
  const noticeZ = Number(components.match(/\.notice-host\{[^}]*z-index:(\d+)/)[1]);
  assert.ok(z > noticeZ, `右下のお知らせ(${noticeZ})より前に出ない(${z})`);
  assert.match(css, /height:100vh; height:100dvh;/, "スマホの上下のバーを考える dvh がない");
  assert.match(css, /html\.standby-open, html\.standby-open body\{overflow:hidden;\}/, "後ろのページのスクロールバーが、画面の端に残る");
  assert.match(css, /html\.standby-open\{scrollbar-gutter:auto;\}/, "スクロールバー用の領域(scrollbar-gutter:stable)が残り、画面の右端が空く");
  assert.match(read("ui/css/tokens.css"), /html\{scrollbar-gutter:stable;\}/, "(前提)既存の scrollbar-gutter の指定");
  assert.match(css, /@media \(orientation:landscape\)[^{]*\{\s*\.sb-stage\{grid-template-columns:/, "横長で、2 列にならない");
  assert.match(css, /\.standby\.sb-idle \.sb-controls\{opacity:0; pointer-events:none;\}/);
  assert.match(css, /\.sb-btn:focus-visible\{outline:/);
  assert.match(css, /min-height:40px/, "ボタンが、タッチで押しにくい");
  assert.match(css, /env\(safe-area-inset-bottom/, "ノッチ・ホームバーに、ボタンが隠れる");
  assert.match(read("ui/index.html"), /<link rel="stylesheet" href="css\/standby\.css">/, "index.html に、CSS が読み込まれていない");
  const sub = css.match(/\.sb-time\{([^}]*)\}/)[1];
  assert.match(sub, /font-size:clamp\(40px, min\(17vmin, 15vw\), 260px\)/);
  assert.match(sub, /white-space:nowrap/, "時間が折り返す");
  assert.match(sub, /tabular-nums/, "数字の幅がそろっていない(桁が動く)");
});

test("後始末", () => { reset(); restoreClock(); });
