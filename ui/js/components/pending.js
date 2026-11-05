// Study Tracker v3 - 「確定前」(保存すると変わる可能性がある)の斜線を付けるための、共通の道具
// 計測が日付をまたいでいる間(store/dayCrossing.js の状態が、null でない間)、pendingDates(= 開始日)に関わる部分に、薄い斜線を重ねる。
//   ・斜線は CSS(components.css の .pend / .pend::after)。数字・文字は読める濃さ。ダークテーマでは、線が自動で明るい色になる。
//   ・色・斜線だけに頼らない: 斜線の部分には、title(ホバー)と、読み上げ用の文字(.sr-only)を付ける。
//   ・対象外(斜線を増やさない): 今日・今月の目標、試験のカード、タグ別の内訳、ポイント履歴、ポイント残高。ポップアップ(crossingNotice)で補う。
// どの画面も、描き直すたびに、いまの状態を読む(日付が変わると、app.js が画面を描き直す)。

import { getCrossing } from "../store/dayCrossing.js";

export const PEND_LABEL = "確定前(保存すると変わる可能性があります)";

// いま「確定前」にする日付(YYYY-MM-DD)の一覧。またいでいなければ、空
export const pendingDates = () => (getCrossing()?.pendingDates ?? []).slice();
export const isCrossing = () => getCrossing() !== null;
export const isPendingDate = (iso) => pendingDates().includes(iso);

// HTML の部品(on が false なら、空の文字)
export const pendClass = (on) => (on ? " pend" : "");
export const pendTitle = (on) => (on ? ` title="${PEND_LABEL}" data-pending="true"` : "");
export const pendSr = (on) => (on ? `<span class="sr-only">${PEND_LABEL}</span>` : "");
