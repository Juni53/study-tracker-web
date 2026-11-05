// Study Tracker v3 - 「計測が日付をまたいでいる」状態(読み取り専用)
// ストップウォッチのストア(store/stopwatch.js)から導く。計測の途中(startDate が決まっている)で、開始日が今日より前なら、
// 「日付をまたいでいる」。保存すると、記録は「開始日」の日付になる(日をまたいで計測した記録は、開始日のものになる。Python 版と同じ)。
// だから、その開始日(pendingDates)に関わる表示は、「保存すると変わる可能性がある(確定前)」ことになる。
//   → 全ページのお知らせ(components/crossingNotice.js)・開始時刻の表示(views/timer.js)・段階 C の斜線が、この状態を使う。
//
// ★規則は、isPending の 1 行だけ。将来、「同じ日でも、計測中なら、開始日を確定前にする」へ広げるときは、
//   `startDate !== null && startDate < today` を `startDate !== null` に変えるだけで済む(状態を使う側は、変えなくてよい)。
//
// 状態は、日付が変わったとき(refreshCrossing(今日)。app.js が、日付の見張りから呼ぶ)と、計測の開始・一時停止・リセットのとき
// (ストップウォッチの subscribe)に、作り直す。中身が変わったときだけ、購読している側に知らせる。
//
// getCrossing() → null(またいでいない) | { startDate: "YYYY-MM-DD", startTime: "HH:MM", pendingDates: ["YYYY-MM-DD"] }

import { stopwatch, subscribe as subscribeStopwatch } from "./stopwatch.js";
import { todayIso } from "../core/dates.js";

// ★「確定前」にする計測の規則(ここだけ)。
export const isPending = (startDate, today) => startDate !== null && startDate < today;

// ストップウォッチ(sw)と今日から、状態を導く(副作用なし)
export function deriveCrossing(sw = stopwatch, today = todayIso()) {
  if (!isPending(sw.startDate, today)) return null;
  return { startDate: sw.startDate, startTime: sw.startTime, pendingDates: [sw.startDate] };
}

const keyOf = (c) => (c ? `${c.startDate} ${c.startTime}` : "");

let state = deriveCrossing();
const listeners = new Set();

export const getCrossing = () => state;

// 状態を作り直す。変わったときだけ、購読している側(fn(新しい状態))に知らせて、true を返す
export function refreshCrossing(today = todayIso()) {
  const next = deriveCrossing(stopwatch, today);
  if (keyOf(next) === keyOf(state)) return false;
  state = next;
  for (const fn of [...listeners]) {
    try { fn(state); } catch (e) { console.error(e); }   // 受け取る側の不具合で、計測の状態の更新を止めない
  }
  return true;
}

export function subscribeCrossing(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// 計測の開始・一時停止・リセット(保存後も含む)のたびに、作り直す(毎秒呼ばれるが、変わらなければ何もしない)
subscribeStopwatch(() => refreshCrossing());
