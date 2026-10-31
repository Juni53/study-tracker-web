// 「アプリとしてインストール」。Chrome / Edge は、ブラウザから届く beforeinstallprompt を保持しておき、
// 設定ページのボタンで表示する。iPad / iPhone(Safari)には、この仕組みが無いので、手順を案内する。
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* 無視 */ } });

export function initInstall(win = globalThis) {
  win.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; notify(); });
  win.addEventListener("appinstalled", () => { deferred = null; notify(); });
}
export const canInstall = () => deferred !== null;
export function onInstallStateChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function promptInstall() {
  if (!deferred) return { outcome: "unavailable" };
  const ev = deferred;
  deferred = null;
  ev.prompt();
  const choice = await ev.userChoice;
  notify();
  return { outcome: choice.outcome };       // "accepted" / "dismissed"
}

// すでにアプリとして開いているか(インストール済みの画面)
export function isStandalone(win = globalThis) {
  const mm = win.matchMedia ? win.matchMedia("(display-mode: standalone)") : null;
  return !!((mm && mm.matches) || (win.navigator && win.navigator.standalone === true));
}

// iPhone / iPad(iPadOS は、デスクトップ表示だと Mac を名乗るので、タッチ点の数でも見分ける)
export function isIos(win = globalThis) {
  const n = win.navigator || {};
  return /iPhone|iPad|iPod/i.test(n.userAgent || "") || (n.platform === "MacIntel" && n.maxTouchPoints > 1);
}
