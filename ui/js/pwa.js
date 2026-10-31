// PWA(インストールとオフライン): Service Worker の登録と、更新の受け取り。
//
// ・公開用のビルド(BUILD_ID が "dev" 以外)のときだけ登録する。開発中の ui/ では何もしない。
// ・初めてのインストールでは、お知らせを出さない(すでに古い版が動いているときだけ、更新のお知らせを出す)。
// ・「更新する」で、待機中の新しい版に切り替えて、再読み込みする。
// ・画面が見える状態に戻ったとき、前回の確認から1時間以上たっていれば、更新を確認する。
import { BUILD_ID } from "./core/buildInfo.js";
import { showUpdateBanner } from "./components/updateBanner.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function applyUpdate(reg, { nav = globalThis.navigator, loc = globalThis.location } = {}) {
  const waiting = reg.waiting;
  if (!waiting) return false;
  let reloaded = false;
  nav.serviceWorker.addEventListener("controllerchange", () => {       // 新しい版に切り替わったら、1度だけ再読み込み
    if (reloaded) return;
    reloaded = true;
    loc.reload();
  });
  waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}

// → "available"(新しい版がある。お知らせから更新できる)/ "installing"(新しい版を取得中)/ "latest"(最新)
export async function checkForUpdate(reg) {
  await reg.update();
  if (reg.waiting) return "available";
  if (reg.installing) return "installing";
  return "latest";
}

export async function registerServiceWorker({
  nav = globalThis.navigator, doc = globalThis.document, buildId = BUILD_ID, onUpdateReady = () => {}, now = () => Date.now(),
} = {}) {
  if (buildId === "dev" || !nav || !nav.serviceWorker) return null;
  let reg;
  try { reg = await nav.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }); }
  catch { return null; }                                                // http のアドレスなど、登録できない環境では、使わないだけ

  const notify = () => onUpdateReady(reg);
  if (reg.waiting && nav.serviceWorker.controller) notify();            // 前に取得して、待機したままの新しい版
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    if (!w) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed" && nav.serviceWorker.controller) notify();   // 初回(controller が無い)は、お知らせを出さない
    });
  });

  let lastCheck = now();
  if (doc && doc.addEventListener) {
    doc.addEventListener("visibilitychange", () => {
      if (doc.visibilityState !== "visible" || now() - lastCheck < CHECK_INTERVAL_MS) return;
      lastCheck = now();
      reg.update().catch(() => {});
    });
  }
  return reg;
}

let current = null;

export async function initPwa(opts = {}) {
  const reg = await registerServiceWorker({
    ...opts,
    onUpdateReady: (r) => showUpdateBanner(() => applyUpdate(r, opts), opts.doc),
  });
  current = reg;
  return reg;
}

// 設定ページの「最新版を確認」用。登録されていない(開発中・非対応)なら "unsupported"
export async function checkNow() {
  if (!current) return "unsupported";
  try { return await checkForUpdate(current); } catch { return "error"; }
}
export const isPwaActive = () => current !== null;
export { BUILD_ID };
