// 日付が変わったことを見張る。アプリを開いたまま日付をまたいでも、起動時処理(さぼり券の自動適用 → ポイントの消失の判定)をやり直し、
// 画面の「今日」を更新する。Web 版は、インストールしたアプリを開きっぱなしにしやすいので必要になる。
//
// ・見張るのは、60秒ごと / 画面が再び見えたとき / 計測の状態が変わったとき。日付が変わっていたら、次の順で進める。
//     1. api.run_day_rollover() で、起動時処理をやり直す(同じ日に何度やっても、二重には適用されない)。
//     2. 画面を描き直す(refresh)。ただし、ポップアップが開いている間・入力中は待つ(使っている最中の画面を、勝手に描き直さない)。
// ・ストップウォッチ(など)が動いている間は、1 も 2 も保留して、右下のお知らせでそれを伝える。計測が終わると、自動で進める。
//     保留するのは、日をまたいで計測した記録が「開始日」の日付で保存されるため。その前に自動処理が走ると、まだ記録の無い開始日に、
//     さぼり券を無駄に使ってしまう。(保存 → 計測のリセットの順なので、計測が終わった時点では、記録はもうある)
// ・お知らせは、保留のあいだだけ出る。「閉じる」で隠せる(保留は続く)。処理が済むと、自動で消える。
//
// startDayWatcher({ api, today, isBusy, subscribeBusy, isIdle, refresh, onRolled }) → { check, viewRendered, stop, state }
//   today()          → "YYYY-MM-DD"(今日)
//   isBusy()         → 計測の途中か(components/../store/stopwatch.js の hasActiveSession)
//   subscribeBusy(fn)→ 計測の状態が変わるたびに fn を呼ぶ登録。解除する関数を返す
//   isIdle()         → 画面を描き直してよいか
//   refresh()        → 画面を描き直す(app.js の refreshActiveView)
//   onRolled(r)      → 起動時処理をやり直したあとに呼ぶ(バックアップのお知らせの再判定など)

import { getNoticeHost } from "./noticeHost.js";

export function startDayWatcher({
  api, today, isBusy, subscribeBusy = null, isIdle = () => true, refresh = async () => {}, onRolled = null,
  doc = document, win = window, intervalMs = 60_000, retryMs = 3_000,
  // タイマー(テストでは差し替える)。ブラウザでは、ふつうのタイマーと同じ。Node では、プロセスの終了を妨げないようにする(unref)
  timers = { setInterval: globalThis.setInterval.bind(globalThis), clearInterval: globalThis.clearInterval.bind(globalThis), setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
}) {
  let lastDay = today();
  let dataPending = false;   // 日付が変わったが、起動時処理をまだやり直していない
  let viewPending = false;   // 起動時処理は済んだが、画面をまだ描き直していない
  let working = false;
  let notice = null;
  let noticeDismissed = false;
  let retryTimer = null;
  let stopped = false;

  function showNotice() {
    if (notice || noticeDismissed) return;
    notice = doc.createElement("div");
    notice.className = "day-notice notice-card";
    notice.setAttribute("role", "status");
    notice.innerHTML = `
      <div class="nt-text">日付が変わりました</div>
      <div class="nt-sub">ストップウォッチの計測中のため、更新を保留しています。計測を止めて保存(またはリセット)すると、自動で更新します。</div>
      <div class="nt-actions"><button type="button" class="btn muted small" data-day="close">閉じる</button></div>`;
    notice.querySelector('[data-day="close"]').addEventListener("click", () => { noticeDismissed = true; hideNotice(); });
    getNoticeHost(doc).appendChild(notice);
  }
  function hideNotice() { if (notice) { notice.remove(); notice = null; } }

  function scheduleRetry() {
    if (retryTimer || stopped) return;
    retryTimer = timers.setTimeout(() => { retryTimer = null; step(); }, retryMs);
    if (retryTimer && typeof retryTimer.unref === "function") retryTimer.unref();
  }

  async function step() {
    if (working || stopped) return;
    working = true;
    try {
      if (!dataPending && today() !== lastDay) { dataPending = true; noticeDismissed = false; }
      if (!dataPending && !viewPending) return;

      if (isBusy()) { showNotice(); return; }   // 計測が終わると、subscribeBusy が、もう一度ここへ来る
      hideNotice();

      if (dataPending) {
        let result = null;
        try { result = await api.run_day_rollover(); } catch (e) { console.error("日付が変わったときの更新に失敗しました", e); scheduleRetry(); return; }
        lastDay = today();      // 処理のあいだに、さらに日付が変わっていたら、次の確認でまた拾う
        dataPending = false;
        viewPending = true;
        if (onRolled) { try { onRolled(result); } catch (e) { console.error(e); } }
      }
      if (viewPending) {
        if (isIdle() && !isBusy()) {
          viewPending = false;
          try { await refresh(); } catch (e) { console.error("画面を更新できませんでした", e); }
        } else {
          scheduleRetry();      // ポップアップ・入力中。閉じたころに、もう一度試す
        }
      }
    } finally {
      working = false;
    }
  }

  const check = () => step();
  const onVisible = () => { if (doc.visibilityState === "visible") step(); };
  const interval = timers.setInterval(check, intervalMs);
  if (interval && typeof interval.unref === "function") interval.unref();
  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("pageshow", check);
  const unsub = subscribeBusy ? subscribeBusy(() => { if (dataPending || viewPending) step(); }) : null;   // 毎秒呼ばれるので、保留中だけ動く

  return {
    check,
    // 画面を描き直した(タブの切り替えなど)。起動時処理が済んでいれば、新しい日付で描かれたので、もう描き直さなくてよい
    viewRendered() { if (!dataPending) viewPending = false; },
    stop() {
      stopped = true;
      timers.clearInterval(interval);
      if (retryTimer) timers.clearTimeout(retryTimer);
      doc.removeEventListener("visibilitychange", onVisible);
      win.removeEventListener("pageshow", check);
      if (unsub) unsub();
      hideNotice();
    },
    get state() { return { lastDay, dataPending, viewPending, noticeShown: !!notice }; },
  };
}
