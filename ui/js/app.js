// Study Tracker v3 - シェル(サイドバー + ルーター)
// サイドバーは固定で、#content の中身だけをタブごとに差し替える。

import { api } from "./api.js";
import { stopwatch, subscribe, hasActiveSession } from "./store/stopwatch.js";
import { loadPrefs } from "./store/pomodoroPrefs.js";
import { startAlerts, refreshInhibit } from "./store/pomodoroAlerts.js";
import { showBackupBannerIfDue } from "./components/backupBanner.js";
import { showOnboardingIfFirst } from "./components/onboarding.js";
import { initInputMode } from "./components/inputMode.js";
import { initInstall } from "./components/install.js";
import { buildNavItems } from "./core/nav.js";
import { todayIso } from "./core/dates.js";
import { updateTodayDates } from "./components/todayDate.js";
import { setBalance } from "./components/points.js";
import { getCrossing, refreshCrossing, subscribeCrossing } from "./store/dayCrossing.js";
import { startCrossingNotice } from "./components/crossingNotice.js";
import { startDayWatcher } from "./components/dayWatcher.js";
import { installLeaveGuard } from "./components/leaveGuard.js";
import { feedbackLink } from "./core/feedback.js";
import { FEEDBACK_URL } from "./config.js";
import { initPwa } from "./pwa.js";
import { EASE_IN, EASE_OUT, reduceMotion, visibleBlocks, staggerIn, revealY } from "./components/motion.js";
import { morphText, initMorph } from "./components/morph.js";

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
  log: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  exam: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  stats: '<path d="M5 20v-9M12 20V5M19 20v-8"/>',
  shop: '<path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  chat: '<path d="M4 5h16v11H10l-5 4v-4H4z"/>',
};

// key: モジュール名(views/<key>.js の render をロードする)。並びは core/nav.js
// 「フィードバック」は、config.js にフォームの URL があるときだけ出す(空、または https の URL でないときは、タブごと出さない)
const feedbackOn = !!feedbackLink();
if (FEEDBACK_URL.trim() && !feedbackOn) console.warn("config.js の FEEDBACK_URL は、https:// で始まる URL にしてください(フィードバックのタブは出しません)");
const NAV = buildNavItems({ feedback: feedbackOn });

const itemsEl = document.getElementById("items");
const contentEl = document.getElementById("content");
const appEl = document.getElementById("app");

// ナビは1回だけ生成する(作り直さないので、アクセント等の動きを途切れさせずに見せられる)
function buildNav() {
  itemsEl.innerHTML = NAV.map((n) => {
    if (n.key === "spacer") return '<div class="spacer"></div>';
    return `<div class="item" data-key="${n.key}" title="${n.label}">
      <span class="accent"></span><svg viewBox="0 0 24 24">${ICON[n.icon]}</svg><span class="lbl">${n.label}</span>
    </div>`;
  }).join("");
  itemsEl.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("click", () => navigate(el.dataset.key));
  });
}

// 選択中のタブを切り替える。アクセントは、タブの位置関係に合わせて上下にスライドする:
// 移動元のアクセントは(移動先が下なら下へ、上なら上へ)自分の領域の外へ出ていき、
// 移動先のアクセントは、反対側(移動先が下なら上)の領域の外から入ってくる。
// 各タブは overflow:hidden なので、2つのタブの間ではアクセントは見えない。
function setActiveNav(key, { animate = true } = {}) {
  const items = [...itemsEl.querySelectorAll(".item")];
  const from = items.find((el) => el.classList.contains("active"));
  const to = items.find((el) => el.dataset.key === key);
  if (!to || from === to) return;
  from?.classList.remove("active");
  to.classList.add("active");
  if (!animate || !from || reduceMotion()) return;
  const dir = items.indexOf(to) > items.indexOf(from) ? 1 : -1; // 1: 下へ移る / -1: 上へ移る
  from.querySelector(".accent").animate(
    [{ transform: "translateY(0)" }, { transform: `translateY(${dir * 100}%)` }],
    { duration: 200, easing: EASE_IN }
  );
  to.querySelector(".accent").animate(
    [{ transform: `translateY(${-dir * 100}%)` }, { transform: "translateY(0)" }],
    { duration: 320, delay: 130, easing: EASE_OUT, fill: "backwards" }
  );
}

const loaded = {}; // key -> { render, onLeave? } のキャッシュ
async function loadView(key) {
  if (loaded[key]) return loaded[key];
  try {
    const mod = await import(`./views/${key}.js`);
    loaded[key] = mod;
    return mod;
  } catch (e) {
    console.error(`view "${key}" の読み込みに失敗しました`, e);
    return null;
  }
}

let currentView = null;

// ── タブ切り替えのアニメーション ──
// 切り替えるとき: いまの画面の要素がフェードアウト → 新しい画面を(見えない状態で)描画 →
// 上の要素から順に、フェードインしながら下から上へスライドして現れる。
// 動きには緩急をつける(出るときは勢いよく入ってゆっくり止まる / 消えるときはゆっくり始まって加速する)。
const FADE_OUT_MS = 160;

async function fadeOutContent() {
  if (reduceMotion() || contentEl.style.visibility === "hidden") return; // 見えていないなら待たない
  const blocks = visibleBlocks(contentEl);
  if (!blocks.length) return;
  const anims = blocks.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: EASE_IN, fill: "forwards" }));
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
}

let navSeq = 0; // 切り替え中にさらに別のタブが押されたとき、古い切り替えを打ち切るための番号
let activeKey = null;
let dayWatcher = null; // 日付の見張り(下で起動する)。タブを描き直したことを知らせる

export async function navigate(key) {
  if (key === activeKey) return; // 同じタブをもう一度押しても、何も起きない(アニメーションも再生しない)
  activeKey = key;
  const seq = ++navSeq;
  setActiveNav(key);

  contentEl.style.pointerEvents = "none"; // 消えていく画面や描画中の画面を、うっかり押さないようにする
  // タブを開くたびに、日付が変わっていないか確認する(変わっていれば、起動時処理のやり直しが済んでから、新しいタブを描く)。
  // いまは画面が使えない状態(上の pointerEvents)なので、ここでは画面の描き直しは起きない。
  if (dayWatcher) await dayWatcher.check();
  await fadeOutContent();
  if (seq !== navSeq) return;

  if (currentView && currentView.onLeave) currentView.onLeave();
  currentView = null;

  const mod = await loadView(key);
  if (seq !== navSeq) return;

  // 描画が終わるまで見せない。visibility なのでレイアウトは計算され、グラフの幅の取得などはこれまでどおり動く
  contentEl.style.visibility = "hidden";
  try {
    if (!mod || typeof mod.render !== "function") {
      contentEl.innerHTML = `<div class="top"><h1>準備中</h1></div><p style="color:var(--ink-sub); padding:20px 4px;">このタブはまだ実装中です。</p>`;
    } else {
      currentView = mod;
      await mod.render(contentEl, api);
    }
  } finally {
    if (seq === navSeq) {
      staggerIn(visibleBlocks(contentEl)); // 先にアニメーションを作ってから(=最初のコマは透明)表示に戻すので、ちらつかない
      contentEl.style.visibility = "";
      contentEl.style.pointerEvents = "";
      if (dayWatcher) dayWatcher.viewRendered();
    }
  }
}

// 開いているタブを、同じタブのまま描き直す(日付が変わったとき、「今日」の表示を新しくする)。
//  - 日付による自動更新のための経路。タブの切り替えのアニメーション(消える → 上から順に現れる)は使わない。
//  - 古い画面と新しい画面を、クロスフェードで入れ替える(View Transitions。document.startViewTransition の既定の動き)。
//    対応していないブラウザ、または「動きを減らす」設定のときは、アニメーションなしで、すぐに入れ替える。
//  - 見ている位置(スクロール)は、そのまま保つ。
//  - 描き直さない画面(views の refreshOnDayChange が false。ストップウォッチ・フィードバック)と、切り替え中は、何もしない(false を返す)。
export async function refreshActiveView() {
  const key = activeKey;
  if (!key || contentEl.style.pointerEvents === "none") return false;
  const mod = await loadView(key);
  if (!mod || typeof mod.render !== "function" || mod.refreshOnDayChange === false) return false;
  if (key !== activeKey || contentEl.style.pointerEvents === "none") return false; // 読み込みのあいだに、切り替えが始まった

  const seq = ++navSeq;                    // これから描き直すあいだに別のタブが押されたら、そちらを優先する
  contentEl.style.pointerEvents = "none";
  const scroller = document.scrollingElement;
  const scrollTop = scroller ? scroller.scrollTop : 0;
  let painted = false;
  const paint = async () => {
    painted = true;
    if (currentView && currentView.onLeave) currentView.onLeave();
    currentView = mod;
    contentEl.style.visibility = "hidden"; // 描画が終わるまで見せない(レイアウトは計算されるので、グラフの幅などは取れる)
    try {
      await mod.render(contentEl, api);
    } finally {
      contentEl.style.visibility = "";
    }
    if (seq === navSeq && scroller) scroller.scrollTop = scrollTop;
  };
  try {
    if (!reduceMotion() && typeof document.startViewTransition === "function") {
      try {
        const vt = document.startViewTransition(paint);
        vt.finished.catch(() => {});       // 中断されても、未処理の失敗にしない
        await vt.updateCallbackDone;       // 描き直しが終わるまで(クロスフェードが終わるのは、待たない)
      } catch (e) {
        if (painted) throw e;              // 描き直しそのものの失敗
        await paint();                     // クロスフェードを始められなかった。そのまま描き直す
      }
    } else {
      await paint();
    }
  } finally {
    if (seq === navSeq) contentEl.style.pointerEvents = "";
  }
  return true;
}

// 画面を、勝手に描き直してよいか(使っている最中でないか)。ポップアップが開いている間と、入力中は、よくない。
export function viewIsIdle(doc = document) {
  if (doc.querySelector(".modal-overlay.open")) return false;
  const a = doc.activeElement;
  if (a && a.closest && a.closest("#content") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  if (contentEl.style.pointerEvents === "none") return false;
  return true;
}

// 案内の「データ管理を開く」: 設定タブを開いて、データ管理の項目まで移る
async function openDataManagement() {
  await navigate("settings");
  document.getElementById("dataSect")?.scrollIntoView?.({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
}

// 案内の「試しに追加」: 試験管理タブを開いて、名前と日付を入れた「試験を追加」のポップアップを出す。
// ポップアップが閉じたら、元のタブへ戻って、{ added: 保存して追加したか } を返す(案内は、そのあいだ隠れていて、同じページに戻る)
export async function openExamAddFromGuide(prefill) {
  const back = activeKey;
  await navigate("exam");
  const mod = await loadView("exam");
  const waiting = mod && typeof mod.openAddExam === "function" ? mod.openAddExam(prefill) : null;
  const result = waiting ? await waiting : null;
  if (back && back !== "exam") await navigate(back);
  return result;
}

// ── レイアウト(折りたたみ / 自動アイコンレール) ──
let collapsed = false;
let lastLayout = null;
function applyLayout() {
  const forced = innerWidth < 700;
  const rail = collapsed || forced;
  const layout = rail ? "rail" : "sidebar";
  appEl.dataset.forced = String(forced);
  appEl.dataset.layout = layout;
  // 幅・文字の出入り・余白は CSS の transition で伸縮する。ストップウォッチ表示は縦横の並びが切り替わるので、
  // 切り替わった瞬間のちらつきをなじませるために、少し遅れてフェードインする。
  if (lastLayout && lastLayout !== layout && !reduceMotion() && typeof timerFooterEl?.animate === "function") {
    timerFooterEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 80, easing: EASE_OUT, fill: "backwards" });
  }
  lastLayout = layout;
  // アイコンの向き(‹ / ›)は CSS の回転で切り替える(パスを入れ替えると滑らかに動かせない)
  document.getElementById("collapseBtn").title = rail ? "サイドバーを展開" : "サイドバーを折りたたむ";
}
document.getElementById("collapseBtn").addEventListener("click", () => {
  collapsed = !collapsed;
  applyLayout();
});
addEventListener("resize", applyLayout);

// ── サイドバー下部: ストップウォッチの現在状態を常に表示する ──
const timerFooterEl = document.querySelector(".timer");
const p2 = (n) => String(n).padStart(2, "0");
const hms = (s) => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
const mmss = (s) => `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
const PHASE_LABEL = { work: "作業中", short_break: "短休憩", long_break: "長休憩" };

// 表示の種類は3つ: 停止中(idle) / ストップウォッチ計測中(sw。ポモドーロも動いていれば2行目に出す) / ポモドーロだけ動いている(pomo)。
// 毎秒の更新では、作り直さずに文字を書き換えるだけにする(作り直すと、ホバーやアニメーションが毎秒リセットされてしまう)。
// 種類が変わるときだけ、文字(ラベルと時間)がクロスフェードする。ポモドーロの2行目(.tp-row)が現れる/消えるときは、
// 高さが動いて、上のタブが滑らかにスライドする。折りたたみ時(.tl と .tp は CSS で非表示)も、時間の表示が同じようにクロスフェードする。
timerFooterEl.innerHTML = `
  <span class="dot"></span>
  <div class="tbody">
    <div class="tl"></div>
    <div class="tt mono"></div>
    <div class="tp-row" hidden><div class="tp mono"></div></div>
  </div>`;
const footDot = timerFooterEl.querySelector(".dot");
const footLabel = timerFooterEl.querySelector(".tl");
const footTime = timerFooterEl.querySelector(".tt");
const footRow = timerFooterEl.querySelector(".tp-row");
const footSub = timerFooterEl.querySelector(".tp");
[footLabel, footTime, footSub].forEach((el) => { initMorph(el, ""); el.classList.add("xf-start"); });
let footKind = null;

function paintFooter() {
  const swOn = stopwatch.running;
  const poOn = stopwatch.pomodoro.running;
  const kind = !swOn && !poOn ? "idle" : swOn ? "sw" : "pomo";
  const changed = footKind !== null && kind !== footKind; // 最初の描画では動かさない

  let label, time, sub = null;
  if (kind === "idle") { label = "停止中"; time = hms(stopwatch.currentSeconds()); }
  else if (kind === "sw") {
    label = "計測中"; time = hms(stopwatch.currentSeconds());
    if (poOn) sub = `${PHASE_LABEL[stopwatch.pomodoro.phase]} ${mmss(stopwatch.pomodoroRemaining())}`;
  } else { label = PHASE_LABEL[stopwatch.pomodoro.phase]; time = mmss(stopwatch.pomodoroRemaining()); }

  timerFooterEl.classList.toggle("idle", kind === "idle");
  footDot.classList.toggle("live", kind !== "idle");
  morphText(footLabel, label, { animate: footKind !== null, width: false });
  morphText(footTime, time, { animate: changed, width: false }); // 同じ種類の中の毎秒の更新は、文字を書き換えるだけ
  if (sub !== null) morphText(footSub, sub, { animate: false, width: false });
  if (footKind === null) footRow.hidden = sub === null; // 最初の描画は動かさない
  else revealY(footRow, sub !== null);
  footKind = kind;
}
subscribe(paintFooter);
paintFooter();
timerFooterEl.addEventListener("click", () => navigate("timer"));

// 保存されているテーマを、どのタブを開くより先に適用する
// animate: テーマを切り替えたときだけ true。色が一斉にフェードして変わる(起動時の適用ではフェードしない)。
// フェード中だけ <html> に theme-fading を付け、CSS(shell.css)がその間だけ色の transition を全要素に効かせる。
let themeFadeTimer = null;
export function applyTheme(mode, { animate = false } = {}) {
  const root = document.documentElement;
  if (animate && !reduceMotion()) {
    root.classList.add("theme-fading");
    clearTimeout(themeFadeTimer);
    themeFadeTimer = setTimeout(() => root.classList.remove("theme-fading"), 650);
  }
  if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
  else root.removeAttribute("data-theme");
}
api.get_settings().then((s) => applyTheme(s && s.theme)).catch(() => {});
// ポモドーロの設定(音・通知・アイドル阻害など)は、ストップウォッチタブを開かなくても効くよう、起動時に読み込む
startAlerts(api);
// タッチ操作のあとに、ホバーの見た目が残り続けないようにする(CSS は components.css の注釈を参照)
initInputMode();
// インストールの案内(beforeinstallprompt は、読み込みの早い時期に届くので、最初に待ち受ける)と、オフライン対応・更新の受け取り
initInstall();
initPwa();
loadPrefs(api).then(refreshInhibit);
// ストップウォッチ(ポモドーロ)の計測の途中で、再読み込み・閉じる・離れる、をしようとしたら、ブラウザの確認を出す(計測は、メモリの中だけにあるため)
installLeaveGuard({ isActive: hasActiveSession });

// 日付が変わったら、見出しの日付をすぐに入れ替え(文字だけ。クロスフェード)、起動時処理(さぼり券の自動適用・ポイントの消失の判定)をやり直して、
// 画面を更新する(クロスフェード)。ストップウォッチが動いていても、待たない(理由は components/dayWatcher.js の注釈)。
// 起動時処理のやり直しのあとで、ポイント残高を新しくし(描き直さない画面にも反映)、バックアップのリマインダーも、もう一度判定する。
dayWatcher = startDayWatcher({
  api, today: todayIso,
  isIdle: viewIsIdle, refresh: refreshActiveView,
  onDayChanged: (day) => { updateTodayDates(day); refreshCrossing(day); },   // 日付の文字を入れ替え、「日付をまたいでいる計測」かの判定もやり直す
  onRolled: (r) => {
    if (r && r.points_balance != null) setBalance(r.points_balance);
    showBackupBannerIfDue(api);
  },
});

// 計測が日付をまたいでいる間は、全ページで、右下に「計測が日付をまたいでいます」を出す(store/dayCrossing.js の状態から)
startCrossingNotice({ getCrossing, subscribeCrossing });
// 「またいでいる」状態が終わったとき(保存・リセット)は、開いている画面の斜線を消すため、静かに描き直す(クロスフェード)。
// 始まるとき(日付が変わったとき)は、日付の見張りが、起動時処理のあとで描き直すので、ここでは何もしない(二重に描き直さない)。
// 使っている最中(ポップアップ・入力中)は、描き直さない。そのときの画面は、次にタブを開いたときに新しくなる。
subscribeCrossing((c) => { if (!c && viewIsIdle()) refreshActiveView().catch((e) => console.error(e)); });

// 起動時のお知らせ: 初めてのときは、先に「はじめに」の案内を出し、閉じたあとで、バックアップのリマインダーを出す
// (周期がたっていれば、右下に小さく出す。起動時に1回だけ。案内の上に重ならないようにする)。
// 案内が出せなくても、リマインダーとアプリ本体は動く。
(async () => {
  try { await showOnboardingIfFirst(api, { onOpenBackup: openDataManagement, onAddExam: openExamAddFromGuide }); } catch (e) { console.error("案内を出せませんでした", e); }
  showBackupBannerIfDue(api);
})();

buildNav();
applyLayout();
setActiveNav("home", { animate: false });
navigate("home");
// 起動直後の配置は動かさない(.no-anim で transition を止めてあり、最初の描画のあとに外す)
requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.remove("no-anim")));
