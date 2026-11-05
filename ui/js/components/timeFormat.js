// Study Tracker v3 - ストップウォッチ・ポモドーロの表示用の文字・数値(ストップウォッチのタブと、待機画面で共通)
// ストア(store/stopwatch.js)の状態から、画面に出す文字を作る。表示の文言・計算を、画面ごとにばらばらにしないための置き場。

import { stopwatch } from "../store/stopwatch.js";
import { deriveCrossing } from "../store/dayCrossing.js";

export const p2 = (n) => String(n).padStart(2, "0");
export const hms = (s) => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
export const mmss = (s) => `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
export const PHASE_LABEL = { work: "作業中", short_break: "短休憩", long_break: "長休憩" };

// 計測を始めた時刻の表示。同じ日は「開始 23:05」、日をまたいでいる間は「11/12 23:05 開始」。
// 一時停止しても、開始時刻は最初のまま。リセット・保存で消える(計測が無い = 開始日が null)。
export function startLabel(sw = stopwatch, crossing = deriveCrossing(sw)) {
  if (sw.startDate === null || !sw.startTime) return "";
  return crossing ? `${sw.startDate.slice(5, 7)}/${sw.startDate.slice(8, 10)} ${sw.startTime} 開始` : `開始 ${sw.startTime}`;
}

// ストップウォッチの状態を表す文字(「計測中」「一時停止中」「停止中」など)
export function swStatusLabel(sw = stopwatch) {
  const po = sw.pomodoro;
  if (sw._autoPausedForBreak) return `休憩中のため自動停止${po.running ? "" : "・休憩も一時停止中"}`;
  if (sw.running) return `計測中${po.linked && po.running ? "・ポモドーロ連動" : ""}`;
  return sw.currentSeconds() > 0 ? "一時停止中" : "停止中";
}

// ポモドーロのリング(円周 377 = 2π × 半径 60)。残り時間に応じて、線の欠け(dashoffset)を求める
export const RING_CIRCUMFERENCE = 377;
export function ringOffset(po = stopwatch.pomodoro, remain = stopwatch.pomodoroRemaining()) {
  const total = po.config[po.phase] * 60;
  return total > 0 ? RING_CIRCUMFERENCE * (1 - remain / total) : 0;
}
