// Study Tracker v3 - フェーズ切り替えの音・デスクトップ通知と、計測中のアイドル阻害
// どのタブを開いていても動くよう、ストア(stopwatch.js)を直接見る。app.js が起動時に1回だけ startAlerts(api) を呼ぶ。
import { stopwatch, subscribe, onPhaseChange } from "./stopwatch.js";
import { prefs } from "./pomodoroPrefs.js";
import { chimeKindFor, playChime } from "../components/chime.js";

const PHASE_NAME = { work: "作業", short_break: "短休憩", long_break: "長休憩" };

// 通知の文面。from → to の切り替えに合わせる
export function notificationText(from, to, config) {
  if (to === "work") return { title: "休憩おわり", message: `${PHASE_NAME[from]}が終わりました。作業(${config.work}分)を始めましょう。` };
  const mins = to === "long_break" ? config.long_break : config.short_break;
  return { title: to === "long_break" ? "長休憩の時間です" : "休憩の時間です", message: `作業が終わりました。${PHASE_NAME[to]}(${mins}分)です。` };
}

// アプリのウィンドウが前面にないとき(最小化・ほかのアプリが前面)だけ、デスクトップ通知を出す
export const isInBackground = () => document.hidden || !document.hasFocus();

let syncNow = () => {};
let askNow = () => {};
// 通知の許可を求める(ブラウザは、ユーザーの操作の直後でないと許可の確認を出さないため、計測を始めたときと、設定を ON にしたときに呼ぶ)
export const refreshNotifyPermission = () => askNow();
// 設定でアイドル阻害を切り替えたときに、すぐ反映する
export const refreshInhibit = () => syncNow();

// 待機画面(components/standby.js)を開いている間は、設定に関わらず、画面の消灯・スリープを防ぐ(待機画面は、つけっぱなしで使うため)。
// 閉じたら、元の設定(計測中だけ防ぐ)に戻る。
let standbyHold = false;
export function setStandbyHold(on) { standbyHold = !!on; syncNow(); }

export function startAlerts(api) {
  onPhaseChange(({ from, to }) => {
    if (prefs.sound) {
      const kind = chimeKindFor(from, to);
      if (kind) playChime(kind, prefs.volume);
    }
    if (prefs.desktopNotify && isInBackground()) {
      const { title, message } = notificationText(from, to, stopwatch.pomodoro.config);
      api.notify_desktop(title, message).catch(() => {});
    }
  });

  // アイドル阻害: 設定がONで、ストップウォッチかポモドーロが動いているあいだだけ(と、待機画面を開いている間)。状態が変わったときだけ API へ伝える
  let inhibiting = false;
  const syncInhibit = () => {
    const want = standbyHold || (prefs.idleInhibit && (stopwatch.running || stopwatch.pomodoro.running));
    if (want === inhibiting) return;
    inhibiting = want;
    api.set_idle_inhibit(want).catch(() => {});
  };
  subscribe(syncInhibit);
  syncNow = syncInhibit;

  // 通知の許可: 設定が ON で、計測を始めたとき(クリック操作の直後)に、まだ決まっていなければ1回だけ確認を出す
  let asked = false;
  const askPermission = () => {
    if (asked || !prefs.desktopNotify) return;
    if (!(stopwatch.running || stopwatch.pomodoro.running)) return;
    asked = true;
    api.request_notification_permission().catch(() => {});
  };
  subscribe(askPermission);
  askNow = () => { if (prefs.desktopNotify) api.request_notification_permission().catch(() => {}); };
}
