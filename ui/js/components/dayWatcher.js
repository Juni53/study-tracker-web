// 日付が変わったことを見張る。アプリを開いたまま日付をまたいでも、画面の日付を新しくし、起動時処理
// (さぼり券の自動適用 → ポイントの消失の判定)をやり直し、画面の「今日」の表示を更新する。
// Web 版は、インストールしたアプリを開きっぱなしにしやすいので必要になる。
//
// 日付が変わったと分かったら、次の順で進める(ストップウォッチが動いていても、待たない)。
//   1. onDayChanged(今日)  … 見出しの日付の文字を、すぐに入れ替える(画面は描き直さない。components/todayDate.js)。
//   2. api.run_day_rollover() で、起動時処理をやり直す(同じ日に何度やっても、二重には適用されない)。成功したら onRolled(結果)。
//   3. 画面を描き直す(refresh)。ただし、ポップアップが開いている間・入力中は待つ(使っている最中の画面を、勝手に描き直さない)。
//
// ★計測中でも保留しない理由(2026-11-02 に、実測で確かめた):
//   ・描き直しても、ストップウォッチは止まらない(計測の状態は、画面ではなく、メモリ上のストアにある)。
//   ・日をまたいで計測した記録は、「開始日」の日付で保存される。その日に、さぼり券が自動適用されていても、
//     記録を保存すると、券が 1 枚戻る(dataManager.js の _refundSaboriIfNeeded。Python 版由来)。
//     毎晩 0 時に更新が走る場合と、計測が終わるまで保留する場合とで、最終状態(券・使った日・連続記録・ポイント)は同じだった。
//     違うのは、計測中だけ券が 1 枚少なく見えることだけ(そこは、画面の斜線とお知らせで「確定前」と示す)。
//
// ★見張りの方法は、「次の 0 時」に 1 回だけ鳴るタイマー(setTimeout)。60 秒ごとの確認(setInterval)は、やめた。
//   ・次の 0 時は、「明日の 0:00」を年月日から組み立てて求める(夏時間の日は 24 時間ではない)。0 時の 1.5 秒後に鳴らす(境界の誤差を避ける)。
//   ・タイマーが鳴ったら、必ず、今日を取り直す(時計の変更・夏時間で、早く鳴ることがある。まだ同じ日なら、張り直すだけ)。
//   ・長いタイマーは、最長 1 時間で刻む(スリープ・時計の変更でずれても、1 時間以内に追いつく)。
//   ・ブラウザは、隠れているページのタイマーを間引く(Chrome 88 以降は、5 分以上隠れたページを 1 分に 1 回まで)。
//     だから、タイマーだけに頼らず、画面が再び見えたとき(visibilitychange)・ウィンドウのフォーカス・pageshow・タブの切り替え
//     (app.js の navigate が check を呼ぶ)でも、すぐに確認する。
//
// startDayWatcher({ api, today, now, isIdle, refresh, onDayChanged, onRolled, ... }) → { check, viewRendered, stop, state }
//   today()          → "YYYY-MM-DD"(今日)
//   now()            → 現在の Date(次の 0 時までの残りを計算する。既定は、共通の時計 core/dates.js の clock.now)
//   isIdle()         → 画面を描き直してよいか(app.js の viewIsIdle)
//   refresh()        → 画面を描き直す(app.js の refreshActiveView)
//   onDayChanged(d)  → 日付が変わったと分かった、すぐに呼ぶ(d = 新しい今日)。見出しの日付の入れ替えなど
//   onRolled(r)      → 起動時処理をやり直したあとに呼ぶ(バックアップのお知らせの再判定、ポイント残高の更新など)
//   check()          → いま、確認する(Promise。起動時処理が済むまで待つ。画面の描き直しが待たされているときは、待たない)

import { clock } from "../core/dates.js";

export const MAX_WAIT_MS = 3_600_000; // 1 回のタイマーの最長(1 時間)
export const MARGIN_MS = 1_500;       // 0 時のあと、これだけ待ってから鳴らす

// 次の 0:00(現地時間)までの、ミリ秒。「明日の 0:00」を年月日から組み立てる(夏時間の日は 24 時間ではない)
export function msUntilNextMidnight(now) {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return next.getTime() - now.getTime();
}

// 次にタイマーを鳴らすまでの、ミリ秒(0 時の少しあと。ただし、最長 1 時間で刻む)
export function nextWatchDelay(now) {
  return Math.min(msUntilNextMidnight(now) + MARGIN_MS, MAX_WAIT_MS);
}

const unref = (t) => { if (t && typeof t.unref === "function") t.unref(); return t; };

export function startDayWatcher({
  api, today, now = () => clock.now(), isIdle = () => true, refresh = async () => {},
  onDayChanged = null, onRolled = null,
  doc = document, win = window, retryMs = 3_000,
  // タイマー(テストでは差し替える)。ブラウザでは、ふつうのタイマーと同じ。Node では、プロセスの終了を妨げないようにする(unref)
  timers = { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) },
}) {
  let lastDay = today();     // 起動時処理をやり直した日(= データが、この日のもの)
  let shownDay = lastDay;    // onDayChanged で知らせた日(= 見出しの日付が、この日のもの)
  let dataPending = false;   // 日付が変わったが、起動時処理をまだやり直していない
  let viewPending = false;   // 起動時処理は済んだが、画面をまだ描き直していない
  let working = null;        // 処理中の Promise(重ならないようにする)
  let retryTimer = null;
  let midnightTimer = null;
  let lastDelay = null;
  let stopped = false;

  function scheduleRetry() {
    if (retryTimer || stopped) return;
    retryTimer = unref(timers.setTimeout(() => { retryTimer = null; check(); }, retryMs));
  }

  async function run() {
    const day = today();
    if (day !== shownDay) {                      // 1. 見出しの日付を、すぐに入れ替える
      shownDay = day;
      if (onDayChanged) { try { onDayChanged(day); } catch (e) { console.error(e); } }
    }
    if (day !== lastDay) dataPending = true;
    if (!dataPending && !viewPending) return;

    if (dataPending) {                           // 2. 起動時処理をやり直す
      let result = null;
      try { result = await api.run_day_rollover(); } catch (e) { console.error("日付が変わったときの更新に失敗しました", e); scheduleRetry(); return; }
      lastDay = today();     // 処理のあいだに、さらに日付が変わっていたら、次の確認でまた拾う
      dataPending = false;
      viewPending = true;
      if (onRolled) { try { onRolled(result); } catch (e) { console.error(e); } }
    }
    if (viewPending) {                           // 3. 画面を描き直す(使っている最中は待つ)
      if (isIdle()) {
        viewPending = false;
        try { await refresh(); } catch (e) { console.error("画面を更新できませんでした", e); }
      } else {
        scheduleRetry();      // ポップアップ・入力中。閉じたころに、もう一度試す
      }
    }
  }

  // 次の 0 時(の少しあと)に鳴るタイマーを、張り直す
  function arm() {
    if (stopped) return;
    if (midnightTimer) timers.clearTimeout(midnightTimer);
    lastDelay = nextWatchDelay(now());
    midnightTimer = unref(timers.setTimeout(() => { midnightTimer = null; check(); }, lastDelay));
  }

  // いま確認して、そのあと、タイマーを張り直す。処理中に呼ばれたら、その処理を待つ。
  function check() {
    if (stopped) return Promise.resolve();
    if (!working) {
      working = run().catch((e) => console.error(e)).finally(() => { working = null; arm(); });
    }
    return working;
  }

  const onVisible = () => { if (doc.visibilityState === "visible") check(); };
  const onWake = () => { check(); };
  doc.addEventListener("visibilitychange", onVisible);
  win.addEventListener("focus", onWake);
  win.addEventListener("pageshow", onWake);
  arm();

  return {
    check,
    // 画面を描き直した(タブの切り替えなど)。起動時処理が済んでいれば、新しい日付で描かれたので、もう描き直さなくてよい
    viewRendered() { if (!dataPending) viewPending = false; },
    stop() {
      stopped = true;
      if (midnightTimer) timers.clearTimeout(midnightTimer);
      if (retryTimer) timers.clearTimeout(retryTimer);
      midnightTimer = retryTimer = null;
      doc.removeEventListener("visibilitychange", onVisible);
      win.removeEventListener("focus", onWake);
      win.removeEventListener("pageshow", onWake);
    },
    get state() { return { lastDay, shownDay, dataPending, viewPending, nextTimerMs: lastDelay }; },
  };
}
