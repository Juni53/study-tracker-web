// Study Tracker v3 - 日付の表示(全タブ共通)
// 各タブの見出し行の右側、ポイントの左に、「2026-11-13 (金)」の形で今日の日付を出す。
//  - 見た目は、ホームにあった日付と同じ(等幅・ink-sub の色。色と大きさは、見出し行 .top .right から引き継ぐ)。
//  - 日付が変わったときは、画面を描き直さずに、文字だけをクロスフェードで入れ替える(updateTodayDates)。
//    クロスフェードは、ボタンの文字などと同じ部品(morph.js の .xf-host / .xf / .xf-out)を使う。
//    ストップウォッチのタブのように、日付が変わっても描き直さない画面でも、これで日付が新しくなる。
//  - 日付の元は、共通の時計(core/dates.js の todayIso)。テストで setClock すれば、そのとおりに出る。
//
// 使い方(各タブの見出し行):
//   <div class="right">${todayDateHtml()}<span class="pts mono">…</span></div>

import { todayIso, weekdayMon0 } from "../core/dates.js";
import { morphText } from "./morph.js";

const WEEKDAY = "月火水木金土日"; // weekdayMon0(月曜 = 0)の並び

// "2026-11-13" → "2026-11-13 (金)"
export function dateLabel(iso = todayIso()) {
  return `${iso} (${WEEKDAY[weekdayMon0(iso)]})`;
}

// 見出し行に置く日付の要素(HTML)。いまの日付で作る。
export function todayDateHtml(iso = todayIso()) {
  return `<span class="today-date mono xf-host xf-inline" data-today-date><span class="xf">${dateLabel(iso)}</span></span>`;
}

// 画面にある日付の要素すべての文字を、iso の日付に入れ替える(同じ文字なら、何もしない)。
// animate: false なら、アニメーションなしで書き換える。
export function updateTodayDates(iso = todayIso(), { animate = true, root = document } = {}) {
  const text = dateLabel(iso);
  root.querySelectorAll("[data-today-date]").forEach((el) => morphText(el, text, { animate, width: false }));
}
