// Study Tracker v3 - 「計測が日付をまたいでいます」のお知らせ(全ページ共通。右下の通知カード。画面は止めない)
// 計測が日付をまたいでいる間(store/dayCrossing.js の状態が、null でない間)、右下に出す。ストップウォッチのタブでも出す。
//  - タイトル: 計測が日付をまたいでいます
//  - 本文: 「11/12 23:05 に開始。保存すると、11/12 の記録になります。」(日付・時刻は、実際の開始日・開始時刻)
//  - 凡例: 斜線の見本(26×12px の枠)+ 「斜線の部分は、保存すると変わる可能性があります。」
//  - ボタン: 「閉じる」。閉じても、斜線(段階 C)は残る。同じ計測のあいだは、また出ない。新しくまたいだときは、また出す。
//  - 保存またはリセットで、またいでいない状態に戻ると、消える。「保留」という言葉は使わない(計測中でも、更新は保留しない)。
//
// startCrossingNotice({ getCrossing, subscribeCrossing, doc }) → { stop, state }

import { getNoticeHost } from "./noticeHost.js";

// "2026-11-12" → "11/12"(ショップの日付と同じ、月/日の 0 埋め)
const monthDay = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
const keyOf = (c) => `${c.startDate} ${c.startTime}`;

export const NOTICE_TITLE = "計測が日付をまたいでいます";
export const NOTICE_LEGEND = "斜線の部分は、保存すると変わる可能性があります。";
export const noticeBody = (c) => `${monthDay(c.startDate)} ${c.startTime} に開始。保存すると、${monthDay(c.startDate)} の記録になります。`;

function esc(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

export function startCrossingNotice({ getCrossing, subscribeCrossing, doc = document }) {
  let card = null;
  let dismissedKey = null;   // 「閉じる」を押した計測(同じ計測では、また出さない)

  function hide() { if (card) { card.remove(); card = null; } }

  function sync(c) {
    if (!c) { hide(); dismissedKey = null; return; }   // またいでいない(保存・リセット)。次にまたいだときは、また出す
    const key = keyOf(c);
    if (key === dismissedKey) return;
    if (card && card.dataset.key === key) return;
    hide();
    card = doc.createElement("div");
    card.className = "crossing-notice notice-card";
    card.dataset.key = key;
    card.setAttribute("role", "status");
    card.innerHTML = `
      <div class="nt-text">${NOTICE_TITLE}</div>
      <div class="nt-sub">${esc(noticeBody(c))}</div>
      <div class="nt-legend"><span class="pend-swatch pend" aria-hidden="true"></span><span>${NOTICE_LEGEND}</span></div>
      <div class="nt-actions"><button type="button" class="btn muted small" data-crossing="close">閉じる</button></div>`;
    card.querySelector('[data-crossing="close"]').addEventListener("click", () => { dismissedKey = key; hide(); });
    getNoticeHost(doc).appendChild(card);
  }

  const unsub = subscribeCrossing(sync);
  sync(getCrossing());
  return {
    stop() { unsub(); hide(); },
    get state() { return { shown: !!card, dismissedKey }; },
  };
}
