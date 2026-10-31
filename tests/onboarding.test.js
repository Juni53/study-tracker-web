// 初回起動時の案内(手順6): API(メタ情報)・ポップアップの動き・設定ページからの再表示・起動の順序。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { buildBackup } from "../ui/js/core/backup.js";
import { setClock } from "../ui/js/core/dates.js";
import { setupDom, key, tick } from "./_dom.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const NOW = () => new Date(2026, 9, 27, 10, 0, 0);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

async function realApi({ idb = new IDBFactory(), platform } = {}) {
  const store = await openStorage({ indexedDB: idb });
  const api = new Api(store, platform ? { platform } : undefined);
  const proxy = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await api[m](...structuredClone(a))) });
  return { store, api, proxy, idb };
}

// ── 1. API(メタ情報) ──
test("API: 最初は「まだ」。complete で日時が付き、2回目以降は最初の日時のまま", async () => {
  const restore = setClock(NOW);
  try {
    const { api } = await realApi();
    assert.deepEqual(api.get_onboarding(), { done: false, seen_at: null, volatile: false });
    assert.deepEqual(api.complete_onboarding(), { ok: true });
    assert.deepEqual(api.get_onboarding(), { done: true, seen_at: "2026-10-27T10:00:00", volatile: false });
    const restore2 = setClock(() => new Date(2026, 10, 3, 8, 0, 0));
    try { api.complete_onboarding(); } finally { restore2(); }
    assert.equal(api.get_onboarding().seen_at, "2026-10-27T10:00:00");
  } finally { restore(); }
});

test("API: ブラウザを開き直しても「見た」ままになる(保存される)", async () => {
  const restore = setClock(NOW);
  try {
    const a = await realApi();
    a.api.complete_onboarding();
    await a.store.flush();
    const b = await realApi({ idb: a.idb });
    assert.equal(b.api.get_onboarding().done, true);
  } finally { restore(); }
});

test("API: 印は、設定(settings.json)にもバックアップにも入らない(Python 版との照合・別の端末での案内を崩さない)", async () => {
  const restore = setClock(NOW);
  try {
    const { api, store } = await realApi();
    api.complete_onboarding();
    assert.ok(!("onboarding" in api.get_settings()));
    assert.ok(!JSON.stringify(store.exportAll()).includes("seen_at"));
    assert.ok(!JSON.stringify(buildBackup(store.exportAll(), "2026-10-27T10:00:00")).includes("onboarding"));
    assert.ok(!/onboarding/.test(read("ui/js/core/defaults.js")), "defaults.js(settings の既定値)に onboarding が入っている");
  } finally { restore(); }
});

test("API: バックアップから復元しても「見た」は残る / 全データ削除では消えて、もう一度出る", async () => {
  const restore = setClock(NOW);
  try {
    const enc = (s) => new TextEncoder().encode(s);
    const platform = { picked: null, async pickFile() { return this.picked; }, async saveFile() { return { ok: true }; }, reload() { this.reloads = (this.reloads || 0) + 1; }, async storageEstimate() { return null; } };
    const { api, store } = await realApi({ platform });
    api.add_record("2026-10-26", "1h", "テスト", [], [], "manual", 4, null);
    api.complete_onboarding();
    platform.picked = { name: "b.json", bytes: enc(JSON.stringify(buildBackup(store.exportAll(), "2026-10-27T10:00:00"))) };
    assert.equal((await api.pick_backup_file()).ok, true);
    assert.equal((await api.apply_backup("replace")).ok, true);
    assert.equal(api.get_onboarding().done, true, "復元で、案内の印が消えた");

    await api.reset_all_data();
    assert.equal(platform.reloads, 1);
    assert.equal(api.get_onboarding().done, false, "全データ削除のあとも、印が残っている");
  } finally { restore(); }
});

// ── 2. ポップアップ ──
const { showOnboarding, showOnboardingIfFirst } = await import("../ui/js/components/onboarding.js");
const { initInstall } = await import("../ui/js/components/install.js");
initInstall(w);

function fakeApi({ done = false, failGet = false, failComplete = false } = {}) {
  const calls = [];
  return {
    calls,
    async get_onboarding() { calls.push("get"); if (failGet) throw new Error("x"); return { done, seen_at: done ? "2026-10-01T00:00:00" : null }; },
    async complete_onboarding() { calls.push("complete"); if (failComplete) throw new Error("x"); return { ok: true }; },
  };
}
const overlay = () => [...document.querySelectorAll(".onb-overlay.open")].pop();
const anyOverlay = () => document.querySelector(".onb-overlay");
const btn = (name) => overlay().querySelector(`[data-onb="${name}"]`);
const settle = async () => { await tick(); await tick(); };
const closeAll = async () => { document.dispatchEvent(key("Escape")); await settle(); };

test("すでに見ていれば出さない(null)/ 状態が取れなくても、例外にならず出さない", async () => {
  assert.equal(await showOnboardingIfFirst(fakeApi({ done: true })), null);
  assert.equal(await showOnboardingIfFirst(fakeApi({ failGet: true })), null);
  assert.equal(anyOverlay(), null);
});

test("保存できない環境(volatile)では、出さない(「保存されます」が事実と違う。その警告が別に出ている)", async () => {
  const store = await openStorage({ indexedDB: null });
  assert.equal(store.volatile, true, "テストの前提: 保存できない環境");
  const api = new Api(store);
  assert.equal(api.get_onboarding().volatile, true);
  const proxy = { get_onboarding: async () => structuredClone(api.get_onboarding()), complete_onboarding: async () => { throw new Error("呼ばれないはず"); } };
  assert.equal(await showOnboardingIfFirst(proxy), null);
  assert.equal(anyOverlay(), null);
});

test("初めてなら出る: 5つの項目・「はじめる」にフォーカス・閉じるまでは「見た」にしない", async () => {
  const api = fakeApi();
  const p = showOnboardingIfFirst(api);
  await settle();
  const o = overlay();
  assert.ok(o, "案内が出ていない");
  const box = o.querySelector(".modal-box");
  assert.equal(box.getAttribute("role"), "dialog");
  assert.equal(box.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(box.getAttribute("aria-labelledby")).textContent, "はじめに");
  const secs = [...o.querySelectorAll("[data-onb-sec]")].map((s) => s.dataset.onbSec);
  assert.deepEqual(secs, ["storage", "backup", "install", "move", "privacy"]);
  const text = o.textContent;
  assert.match(text, /このブラウザの中/);
  assert.match(text, /別の端末や、別のブラウザとは共有されません/);
  assert.match(text, /定期的にバックアップ/);
  assert.match(text, /バックアップを保存/);
  assert.match(text, /バックアップから復元/);
  assert.match(text, /外部のサーバーへ送られません/);
  assert.match(o.querySelector(".onb-lead").textContent, /ようこそ/);
  assert.equal(btn("done").textContent, "はじめる");
  assert.equal(document.activeElement, btn("done"));
  assert.deepEqual(api.calls, ["get"], "閉じる前に「見た」にしている");
  await closeAll();
  await p;
});

test("「はじめる」で閉じて、「見た」を1回だけ付ける", async () => {
  const api = fakeApi();
  const p = showOnboardingIfFirst(api);
  await settle();
  const o = overlay();
  btn("done").click();
  await p;
  await settle();
  assert.equal(o.classList.contains("open"), false);
  assert.deepEqual(api.calls, ["get", "complete"]);
});

test("× と Esc でも閉じて、「見た」を付ける。背景を押しても閉じない", async () => {
  let api = fakeApi();
  let p = showOnboardingIfFirst(api);
  await settle();
  overlay().dispatchEvent(new w.MouseEvent("click", { bubbles: true }));   // 背景(ポップアップの外)
  await settle();
  assert.ok(overlay(), "背景を押して閉じてしまった");
  btn("close").click();
  await p; await settle();
  assert.deepEqual(api.calls, ["get", "complete"]);

  api = fakeApi();
  p = showOnboardingIfFirst(api);
  await settle();
  document.dispatchEvent(key("Escape"));
  await p; await settle();
  assert.deepEqual(api.calls, ["get", "complete"]);
  assert.equal(overlay(), undefined);
});

test("「データ管理を開く」: 閉じて(見た印を付けて)から、渡された処理を1回だけ呼ぶ", async () => {
  const api = fakeApi();
  const order = [];
  const origComplete = api.complete_onboarding;
  api.complete_onboarding = async () => { order.push("complete"); return origComplete.call(api); };
  const p = showOnboardingIfFirst(api, { onOpenBackup: () => order.push(overlay() ? "open-while-visible" : "open") });
  await settle();
  btn("backup").click();
  await p; await settle();
  assert.deepEqual(order, ["complete", "open"]);
});

test("見た印が付けられなくても、案内は閉じる(例外を外へ出さない)", async () => {
  const api = fakeApi({ failComplete: true });
  const p = showOnboardingIfFirst(api);
  await settle();
  btn("done").click();
  await p; await settle();
  assert.equal(overlay(), undefined);
});

test("見直し(first:false): 文言は「閉じる」で、閉じても「見た」の印は触らない", async () => {
  const api = fakeApi({ done: true });
  const p = showOnboarding(api, { first: false });
  await settle();
  assert.equal(btn("done").textContent, "閉じる");
  assert.doesNotMatch(overlay().querySelector(".onb-lead").textContent, /ようこそ/);
  btn("done").click();
  await p; await settle();
  assert.deepEqual(api.calls, []);
});

test("Tab はポップアップの中だけを巡る(非表示のボタンは飛ばす)/ Enter の押しっぱなしは無視", async () => {
  const api = fakeApi();
  const p = showOnboardingIfFirst(api);
  await settle();
  const visible = [...overlay().querySelectorAll("button")].filter((b) => !b.closest("[hidden]"));
  assert.ok(!visible.includes(btn("install")), "インストールの合図が無いのに、ボタンが巡る対象にある");
  assert.deepEqual(visible.map((b) => b.dataset.onb), ["close", "backup", "done"]);
  assert.equal(document.activeElement, btn("done"));
  document.dispatchEvent(key("Tab"));                      // 末尾 → 先頭
  assert.equal(document.activeElement, btn("close"));
  assert.ok(overlay().classList.contains("kbd"));
  document.dispatchEvent(key("Tab", { shiftKey: true }));  // 先頭 → 末尾
  assert.equal(document.activeElement, btn("done"));
  // 先頭から順に巡る: ×(close) → データ管理(backup) → はじめる(done)。隠れているインストールのボタンには止まらない
  document.dispatchEvent(key("Tab"));
  const order = [document.activeElement.dataset.onb];
  for (let i = 0; i < 2; i++) { document.dispatchEvent(key("Tab")); order.push(document.activeElement.dataset.onb); }
  assert.deepEqual(order, ["close", "backup", "done"]);
  const rep = key("Enter", { repeat: true });
  document.dispatchEvent(rep);
  assert.equal(rep.defaultPrevented, true);
  assert.ok(overlay(), "押しっぱなしで閉じた");
  await closeAll();
  await p;
});

test("インストールの項目: 手順の文 → 合図が来たらボタン → 押すと案内を出す → インストール済みなら項目ごと隠す", async () => {
  const api = fakeApi();
  const p = showOnboardingIfFirst(api);
  await settle();
  const sec = overlay().querySelector('[data-onb-sec="install"]');
  assert.equal(sec.hidden, false);
  assert.match(sec.textContent, /Chrome \/ Edge のアドレスバーの右/);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, true);

  let prompted = 0;
  const ev = new w.Event("beforeinstallprompt", { cancelable: true });
  ev.prompt = () => { prompted++; };
  ev.userChoice = Promise.resolve({ outcome: "accepted" });
  w.dispatchEvent(ev);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, false);
  assert.doesNotMatch(sec.textContent, /Chrome \/ Edge のアドレスバーの右/);
  btn("install").click();
  await settle();
  assert.equal(prompted, 1);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, true);   // 案内を出したら、もうボタンは出さない
  await closeAll();
  await p;

  // すでにアプリとして開いている
  const prev = globalThis.matchMedia;
  globalThis.matchMedia = (q) => ({ matches: /standalone/.test(q) });
  try {
    const p2 = showOnboarding(fakeApi(), { first: false });
    await settle();
    assert.equal(overlay().querySelector('[data-onb-sec="install"]').hidden, true);
    assert.ok(![...overlay().querySelectorAll("button")].filter((b) => !b.closest("[hidden]")).includes(btn("install")));
    await closeAll();
    await p2;
  } finally { globalThis.matchMedia = prev; }
});

test("インストールの項目: iPad / iPhone では、「ホーム画面に追加」の手順になる", async () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari", platform: "iPad", maxTouchPoints: 5 }, configurable: true });
  try {
    const p = showOnboarding(fakeApi(), { first: false });
    await settle();
    assert.match(overlay().querySelector('[data-onb-sec="install"]').textContent, /共有ボタンから「ホーム画面に追加」/);
    await closeAll();
    await p;
  } finally { if (desc) Object.defineProperty(globalThis, "navigator", desc); else delete globalThis.navigator; }
});

// ── 3. 設定ページからの再表示 ──
test("設定ページ: 「はじめに」ボタンで見直せる(印は変わらない)/「データ管理を開く」で、このページのデータ管理へ移る", async () => {
  const restore = setClock(NOW);
  try {
    const { proxy, api } = await realApi();
    const scrolled = [];
    w.Element.prototype.scrollIntoView = function () { scrolled.push(this.id); };
    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, proxy);
    assert.ok(root.querySelector("#dataSect"), "データ管理の項目に id が無い");

    root.querySelector("#onboardingBtn").click();
    await settle();
    assert.equal(btn("done").textContent, "閉じる");
    btn("done").click();
    await settle();
    assert.equal(api.get_onboarding().done, false, "見直しただけで、見た印が付いた");

    root.querySelector("#onboardingBtn").click();
    await settle();
    btn("backup").click();
    await settle();
    assert.deepEqual(scrolled, ["dataSect"]);
    assert.equal(api.get_onboarding().done, false);
  } finally { restore(); }
});

// ── 4. 起動の順序・見た目の決まりごと ──
test("起動(app.js): 案内を先に出し、閉じたあとにバックアップのお知らせ。案内が失敗しても、お知らせは出す", () => {
  const app = read("ui/js/app.js");
  const a = app.indexOf("showOnboardingIfFirst(api");
  const b = app.indexOf("showBackupBannerIfDue(api);");
  assert.ok(a > 0 && b > a, "案内より前に、バックアップのお知らせを出している");
  const between = app.slice(a - 40, b);
  assert.match(between, /await showOnboardingIfFirst/);
  assert.match(between, /catch/);
  assert.match(app, /onOpenBackup: openDataManagement/);
});

test("見た目: 案内は、上下を固定して真ん中だけスクロールする(長くても「はじめる」が画面から出ない)", () => {
  const css = read("ui/css/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.modal-box\.onb\{[^}]*display:flex; flex-direction:column; overflow:hidden/);
  assert.match(css, /\.onb-body\{[^}]*min-height:0; overflow-y:auto/);
  assert.match(css, /\.onb-head\{[^}]*flex:none/);
  assert.match(css, /\.onb-foot\{[^}]*flex:none/);
});
