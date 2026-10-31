// Study Tracker v3 - ポモドーロの設定(アプリ全体で1つ)
// 作業/休憩の長さ・サイクル数に加えて、音・音量・デスクトップ通知・アイドル阻害の設定を持つ。
// 保存先は settings の "pomodoro"。アプリ起動時に1回だけ読み込み(app.js)、ストップウォッチタブを開いていなくても、
// 音や通知が設定どおりに動くようにする。
import { stopwatch } from "./stopwatch.js";

export const prefs = {
  sound: true,            // フェーズ切り替えの音
  volume: 60,             // 音量 0〜100
  desktopNotify: true,    // デスクトップ通知(アプリが前面にないときだけ)
  idleInhibit: false,     // 計測中は、画面の消灯・スリープを防ぐ
};

let loading = null;

export function loadPrefs(api) {
  if (!loading) {
    loading = (async () => {
      try {
        const s = await api.get_settings();
        const p = s && s.pomodoro;
        if (!p) return;
        const { pause_sw_on_break, sound, volume, desktop_notify, idle_inhibit, ...cfg } = p;
        stopwatch.configurePomodoro(cfg);
        if (pause_sw_on_break != null) stopwatch.pomodoro.pauseSwOnBreak = pause_sw_on_break;
        if (sound != null) prefs.sound = !!sound;
        if (volume != null) prefs.volume = Math.min(100, Math.max(0, Number(volume) || 0));
        if (desktop_notify != null) prefs.desktopNotify = !!desktop_notify;
        if (idle_inhibit != null) prefs.idleInhibit = !!idle_inhibit;
      } catch (e) { console.error(e); }
    })();
  }
  return loading;
}

export function savePrefs(api) {
  return api.update_setting("pomodoro", {
    ...stopwatch.pomodoro.config,
    pause_sw_on_break: stopwatch.pomodoro.pauseSwOnBreak,
    sound: prefs.sound,
    volume: prefs.volume,
    desktop_notify: prefs.desktopNotify,
    idle_inhibit: prefs.idleInhibit,
  });
}
