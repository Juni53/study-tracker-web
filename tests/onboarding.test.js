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
globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} }); // 動きを減らす設定(jsdom には Element.animate が無いので、アニメーションを使わせない)
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

// ── 1b. タグ選び(API) ──
const { ONBOARDING_TAGS, DEFAULT_TAGS, F } = await import("../ui/js/core/defaults.js");
const tagNames = (api) => api.get_tags().map((t) => t.name);

test("タグの候補: 国語・数学・英語・生物・化学・物理・社会・情報・その他(この順)で、いまの既定のタグ6つは、色も同じ", () => {
  assert.deepEqual(ONBOARDING_TAGS.map((t) => t.name), ["国語", "数学", "英語", "生物", "化学", "物理", "社会", "情報", "その他"]);
  for (const d of DEFAULT_TAGS) assert.equal(ONBOARDING_TAGS.find((t) => t.name === d.name)?.color, d.color, `${d.name} の色`);
  assert.equal(new Set(ONBOARDING_TAGS.map((t) => t.color)).size, 9, "色が重なっている");
});

test("タグ(API): 最初は、既定の6つがチェック済み・生物/社会/情報は外れている。使用中は無い", async () => {
  const { api } = await realApi();
  const r = api.get_onboarding_tags();
  assert.deepEqual(r.tags.map((t) => t.name), ONBOARDING_TAGS.map((t) => t.name));
  const on = r.tags.filter((t) => t.checked).map((t) => t.name).sort();
  assert.deepEqual(on, DEFAULT_TAGS.map((t) => t.name).sort());
  assert.deepEqual(r.tags.filter((t) => !t.checked).map((t) => t.name), ["生物", "社会", "情報"]);
  assert.ok(r.tags.every((t) => t.in_use === false));
});

test("タグ(API): 選んだとおりに足す(「その他」の手前へ・色つき)/ 外したものは、使っていなければ消す", async () => {
  const { api } = await realApi();
  const sel = ["国語", "数学", "英語", "生物", "化学", "社会", "情報", "その他"];       // 物理を外し、生物・社会・情報を足す
  const r = api.apply_onboarding_tags(sel);
  assert.deepEqual(r, { ok: true, added: ["生物", "社会", "情報"], removed: ["物理"], kept: [] });
  assert.deepEqual(tagNames(api), ["数学", "英語", "化学", "国語", "生物", "社会", "情報", "その他"]);   // 元の並びのまま、新しいものは「その他」の前
  const color = (n) => api.get_tags().find((t) => t.name === n).color;
  for (const n of ["生物", "社会", "情報"]) assert.equal(color(n), ONBOARDING_TAGS.find((t) => t.name === n).color);
  const ids = api.get_tags().map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "id が重なっている");
});

test("タグ(API): 記録で使っているタグは、外されても残す(kept)/ 自分で作ったタグには触らない", async () => {
  const { api } = await realApi();
  const math = api.get_tags().find((t) => t.name === "数学").id;
  const mine = api.add_tag("自作タグ", "#123456");
  api.add_record("2026-10-26", "1h", "テスト", [math], [], "manual", 4, null);
  assert.equal(api.get_onboarding_tags().tags.find((t) => t.name === "数学").in_use, true);
  const r = api.apply_onboarding_tags([]);                                    // 全部外す
  assert.deepEqual(r.kept, ["数学"]);
  assert.deepEqual(r.removed.sort(), ["その他", "化学", "国語", "物理", "英語"].sort());
  assert.deepEqual(tagNames(api).sort(), ["数学", "自作タグ"].sort());
  assert.deepEqual(api.get_records()[0].tag_ids, [math], "使用中のタグが、記録から外れた");
  assert.ok(api.get_tags().some((t) => t.id === mine.id && t.color === "#123456"));
});

test("タグ(API): 変更が無ければ、何も書き込まない / 知らない名前は、何も変えずに拒否", async () => {
  const { api, store } = await realApi();
  let writes = 0;
  const orig = store.save.bind(store);
  store.save = (name, v) => { if (name === F.tags || name === F.records) writes++; return orig(name, v); };
  const before = JSON.stringify(api.get_tags());
  assert.deepEqual(api.apply_onboarding_tags(DEFAULT_TAGS.map((t) => t.name)), { ok: true, added: [], removed: [], kept: [] });
  assert.equal(writes, 0, "変更が無いのに、書き込んだ");
  for (const bad of [["数学", "体育"], "数学", null, [1]]) {
    assert.equal(api.apply_onboarding_tags(bad).ok, false);
  }
  assert.equal(JSON.stringify(api.get_tags()), before);
});

test("タグ(API): 「その他」を外して足しても、「その他」だけを足し直しても、並びが崩れない", async () => {
  const { api } = await realApi();
  api.apply_onboarding_tags(["国語", "数学", "英語", "化学", "物理"]);          // その他を外す
  assert.ok(!tagNames(api).includes("その他"));
  api.apply_onboarding_tags(["国語", "数学", "英語", "生物", "化学", "物理", "その他"]);   // 生物とその他を足す
  assert.deepEqual(tagNames(api), ["数学", "英語", "物理", "化学", "国語", "生物", "その他"]);   // 元の並び(その他は外れていた)+ 足した生物 + 足し直したその他
});

// ── 2. ポップアップ(複数ページ) ──
const { showOnboarding, showOnboardingIfFirst, PAGES, SAMPLE_EXAM } = await import("../ui/js/components/onboarding.js");
const { initInstall } = await import("../ui/js/components/install.js");
initInstall(w);

const TITLES = ["ホーム", "ストップウォッチ", "記録ログ", "カレンダー", "試験管理", "統計", "ショップ", "設定", "タグ", "注意事項"];
const LAST = TITLES.length - 1;

function fakeApi({ done = false, failGet = false, failComplete = false, tags = null, applyResult = { ok: true }, exams = [] } = {}) {
  const calls = [];
  const tagList = tags ?? ONBOARDING_TAGS.map((t) => ({ name: t.name, color: t.color, checked: DEFAULT_TAGS.some((d) => d.name === t.name), in_use: false }));
  return {
    calls, applied: [],
    async get_onboarding() { calls.push("get"); if (failGet) throw new Error("x"); return { done, seen_at: done ? "2026-10-01T00:00:00" : null }; },
    async complete_onboarding() { calls.push("complete"); if (failComplete) throw new Error("x"); return { ok: true }; },
    async get_onboarding_tags() { return { tags: structuredClone(tagList) }; },
    async apply_onboarding_tags(names) { this.applied.push([...names]); if (applyResult instanceof Error) throw applyResult; return applyResult; },
    async get_exams() { return exams; },
  };
}
const overlay = () => [...document.querySelectorAll(".onb-overlay.open")].pop();
const anyOverlay = () => document.querySelector(".onb-overlay.open");
const btn = (name) => overlay().querySelector(`button[data-onb="${name}"]`);
const title = () => overlay().querySelector('[data-onb="title"]').textContent;
const stepText = () => overlay().querySelector('[data-onb="step"]').textContent;
const bodyEl = () => overlay().querySelector('[data-onb="body"]');
const settle = async () => { await tick(); await tick(); await tick(); };
const closeAll = async () => { document.dispatchEvent(key("Escape")); await settle(); };
async function next(n = 1) { for (let i = 0; i < n; i++) { btn("next").click(); await settle(); } }
async function open(opts = {}, apiOpts = {}) {
  const api = fakeApi(apiOpts);
  const p = showOnboardingIfFirst(api, opts);
  await settle();
  return { api, p };
}

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

test("ページの並び: 各タブ(ホーム〜設定) → タグ → 注意事項(最後)", () => {
  assert.deepEqual(PAGES.map((p) => p.title), TITLES);
  assert.deepEqual(PAGES.map((p) => p.key), ["home", "timer", "log", "cal", "exam", "stats", "shop", "settings", "tags", "notes"]);
});

test("初めてなら出る: 1ページ目はホーム(ようこそ)・「戻る」は無い・「次へ」にフォーカス・閉じるまでは「見た」にしない", async () => {
  const { api, p } = await open();
  const o = overlay();
  assert.ok(o, "案内が出ていない");
  const box = o.querySelector(".modal-box");
  assert.equal(box.getAttribute("role"), "dialog");
  assert.equal(box.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(box.getAttribute("aria-labelledby")).textContent, "ホーム");
  assert.equal(stepText(), `1 / ${TITLES.length}`);
  assert.match(bodyEl().textContent, /Study Tracker へようこそ/);
  assert.equal(btn("prev").hidden, true);
  assert.equal(btn("next").textContent, "次へ");
  assert.equal(document.activeElement, btn("next"));
  assert.equal(o.querySelectorAll(".onb-dots span.on").length, 1);
  assert.deepEqual(api.calls, ["get"], "閉じる前に「見た」にしている");
  await closeAll();
  await p;
});

test("「次へ / 戻る」で、全ページをめくれる(順番・ステップ表示・ドット・最後のボタン)", async () => {
  const { api, p } = await open();
  for (let i = 0; i < TITLES.length; i++) {
    assert.equal(title(), TITLES[i]);
    assert.equal(stepText(), `${i + 1} / ${TITLES.length}`);
    assert.equal([...overlay().querySelectorAll(".onb-dots span")].findIndex((d) => d.classList.contains("on")), i);
    assert.equal(btn("prev").hidden, i === 0);
    assert.equal(btn("next").textContent, i === LAST ? "はじめる" : "次へ");
    if (i < LAST) await next();
  }
  btn("prev").click(); await settle();
  assert.equal(title(), TITLES[LAST - 1]);
  assert.equal(btn("next").textContent, "次へ");
  assert.deepEqual(api.calls, ["get"], "めくっただけで「見た」にしている");
  await closeAll();
  await p;
});

test("各タブのページに、そのタブの説明がある(実際の機能に合った言葉)", async () => {
  const { p } = await open();
  const expect = {
    "ホーム": [/連続記録/, /7日続けるごと/, /週間|1週間/, /目標/],
    "ストップウォッチ": [/開始/, /保存/, /ポモドーロ/, /ポイント/],
    "記録ログ": [/手動で追加/, /0\.75倍/, /当日だけ/, /タグでの絞り込み/],
    "カレンダー": [/色の濃さ/, /日付を押す/],
    "試験管理": [/名前・日付・目標/, /学習進捗/, /期間消化/, /70ポイント/],
    "統計": [/今週・今月・全期間/, /タグ別の内訳/, /充実度/],
    "ショップ": [/報酬を追加/, /さぼり券/, /500ポイント/, /毎日2%/],
    "設定": [/表示テーマ/, /タグ/, /データ管理/, /高度な設定/],
    "タグ": [/科目などを分ける印/, /最初に使う科目/],
  };
  for (let i = 0; i < LAST; i++) {
    for (const re of expect[TITLES[i]]) assert.match(bodyEl().textContent, re, `${TITLES[i]} のページ: ${re}`);
    await next();
  }
  await closeAll();
  await p;
});

test("最後のページは「注意事項」: 保存場所・バックアップ・インストール・端末を移るとき・プライバシー", async () => {
  const { p } = await open();
  await next(LAST);
  assert.equal(title(), "注意事項");
  const secs = [...overlay().querySelectorAll("[data-onb-sec]")].map((s) => s.dataset.onbSec);
  assert.deepEqual(secs, ["storage", "backup", "install", "move", "privacy"]);
  const text = bodyEl().textContent;
  assert.match(text, /このブラウザの中/);
  assert.match(text, /別の端末や、別のブラウザとは共有されません/);
  assert.match(text, /定期的にバックアップ/);
  assert.match(text, /バックアップを保存/);
  assert.match(text, /バックアップから復元/);
  assert.match(text, /外部のサーバーへ送られません/);
  await closeAll();
  await p;
});

test("最後の「はじめる」で閉じて、「見た」を1回だけ付ける", async () => {
  const { api, p } = await open();
  await next(LAST);
  const o = overlay();
  btn("next").click();
  await p; await settle();
  assert.equal(o.classList.contains("open"), false);
  assert.deepEqual(api.calls, ["get", "complete"]);
});

test("途中でも、× と Esc で閉じて「見た」を付ける。背景を押しても閉じない", async () => {
  let { api, p } = await open();
  await next(2);
  overlay().dispatchEvent(new w.MouseEvent("click", { bubbles: true }));   // 背景(ポップアップの外)
  await settle();
  assert.ok(overlay(), "背景を押して閉じてしまった");
  btn("close").click();
  await p; await settle();
  assert.deepEqual(api.calls, ["get", "complete"]);

  ({ api, p } = await open());
  document.dispatchEvent(key("Escape"));
  await p; await settle();
  assert.deepEqual(api.calls, ["get", "complete"]);
  assert.equal(overlay(), undefined);
});

test("「データ管理を開く」(最後のページ): 閉じて(見た印を付けて)から、渡された処理を1回だけ呼ぶ", async () => {
  const order = [];
  const { api, p } = await open({ onOpenBackup: () => order.push(overlay() ? "open-while-visible" : "open") });
  const origComplete = api.complete_onboarding;
  api.complete_onboarding = async () => { order.push("complete"); return origComplete.call(api); };
  await next(LAST);
  btn("backup").click();
  await p; await settle();
  assert.deepEqual(order, ["complete", "open"]);
});

test("見た印が付けられなくても、案内は閉じる(例外を外へ出さない)", async () => {
  const { p } = await open({}, { failComplete: true });
  await next(LAST);
  btn("next").click();
  await p; await settle();
  assert.equal(overlay(), undefined);
});

test("見直し(first:false): ようこそ・「はじめる」は出ず、最後は「閉じる」。閉じても「見た」の印は触らない", async () => {
  const api = fakeApi({ done: true });
  const p = showOnboarding(api, { first: false });
  await settle();
  assert.doesNotMatch(bodyEl().textContent, /ようこそ/);
  await next(LAST);
  assert.equal(btn("next").textContent, "閉じる");
  btn("next").click();
  await p; await settle();
  assert.deepEqual(api.calls, []);
});

test("Tab はポップアップの中だけを巡る(隠れたボタンは飛ばす)/ Enter の押しっぱなしは無視", async () => {
  const { p } = await open();
  const visible = () => [...overlay().querySelectorAll("button, input[type=checkbox]")].filter((b) => !b.disabled && !b.closest("[hidden]") && !b.hidden);
  assert.deepEqual(visible().map((b) => b.dataset.onb), ["close", "next"]);          // 1ページ目: 「戻る」は隠れている
  assert.equal(document.activeElement, btn("next"));
  document.dispatchEvent(key("Tab"));                                                  // 末尾 → 先頭
  assert.equal(document.activeElement, btn("close"));
  assert.ok(overlay().classList.contains("kbd"));
  document.dispatchEvent(key("Tab", { shiftKey: true }));                              // 先頭 → 末尾
  assert.equal(document.activeElement, btn("next"));
  await next();                                                                        // 2ページ目: 戻る・次へが出る
  assert.deepEqual(visible().map((b) => b.dataset.onb), ["close", "prev", "next"]);
  btn("close").focus();
  document.dispatchEvent(key("Tab")); assert.equal(document.activeElement, btn("prev"));
  document.dispatchEvent(key("Tab")); assert.equal(document.activeElement, btn("next"));
  const rep = key("Enter", { repeat: true });
  document.dispatchEvent(rep);
  assert.equal(rep.defaultPrevented, true);
  assert.ok(overlay(), "押しっぱなしで閉じた");
  await closeAll();
  await p;
});

// ── 試験管理のページ ──
test("試験のページ: 「二学期期末試験 を追加」ボタン → 名前・日付つきで追加画面を呼ぶ。そのあいだ案内は隠れ(閉じた扱いにはしない)、閉じたら同じページへ戻る", async () => {
  const restore = setClock(NOW);
  try {
    let resolveExam; const asked = [];
    const { api, p } = await open({ onAddExam: (pre) => { asked.push(pre); return new Promise((r) => { resolveExam = r; }); } });
    await next(4);
    assert.equal(title(), "試験管理");
    const b = btn("exam");
    assert.equal(b.textContent, "二学期期末試験 を追加");
    assert.deepEqual([SAMPLE_EXAM.name, SAMPLE_EXAM.date], ["２学期期末試験", "2026-11-24"]);
    b.click(); await settle();
    assert.deepEqual(asked, [{ name: "２学期期末試験", date: "2026-11-24" }]);
    assert.equal(anyOverlay(), null, "追加画面が出るあいだ、案内が隠れていない");
    b.click(); await settle();                                                  // 追加画面のあいだに、もう一度押されても、2つ目は開かない
    assert.equal(asked.length, 1, "追加画面が二重に開いた");
    document.dispatchEvent(key("Escape")); await settle();                    // 追加画面のあいだは、案内はキーを受けない
    resolveExam({ added: false }); await settle();
    assert.ok(overlay(), "追加画面が閉じたのに、案内が戻らない");
    assert.equal(title(), "試験管理", "別のページに戻った");
    assert.equal(btn("exam").disabled, false, "追加していないのに、ボタンが使えない");
    assert.deepEqual(api.calls, ["get"], "隠れただけで「見た」にしている");

    btn("exam").click(); await settle();                                       // もう一度 → 今度は追加した
    resolveExam({ added: true }); await settle();
    assert.equal(btn("exam").disabled, true);
    assert.match(overlay().querySelector('[data-onb="examNote"]').textContent, /追加しました/);
    await closeAll();
    await p;
    assert.deepEqual(api.calls, ["get", "complete"]);
  } finally { restore(); }
});

test("試験のページ: 追加済みならボタンは使えない / 渡されていなければ出ない / 日付が過ぎたら出ない", async () => {
  const restore = setClock(NOW);
  try {
    let { p } = await open({ onAddExam: async () => ({ added: false }) }, { exams: [{ id: 1, name: "２学期期末試験", date: "2026-11-24" }] });
    await next(4);
    assert.equal(btn("exam").disabled, true);
    assert.match(overlay().textContent, /追加しました/);
    await closeAll(); await p;

    ({ p } = await open());                                                    // onAddExam なし
    await next(4);
    assert.equal(overlay().querySelector('[data-onb="exam"]'), null);
    await closeAll(); await p;
  } finally { restore(); }
  const late = setClock(() => new Date(2026, 10, 25, 9, 0, 0));                // 試験日の翌日
  try {
    const { p } = await open({ onAddExam: async () => ({ added: false }) });
    await next(4);
    assert.equal(overlay().querySelector('[data-onb="exam"]'), null);
    await closeAll(); await p;
  } finally { late(); }
});

// ── タグのページ ──
const chk = () => [...overlay().querySelectorAll('input[type="checkbox"][data-tag]')];
const toggle = (name) => { const c = chk().find((x) => x.dataset.tag === name); c.checked = !c.checked; c.dispatchEvent(new w.Event("change", { bubbles: true })); };

test("タグのページ: 候補9つが指定の順にチェックボックスで並び、いまのタグ(既定の6つ)だけがチェック済み", async () => {
  const { p } = await open();
  await next(8);
  assert.equal(title(), "タグ");
  assert.deepEqual(chk().map((c) => c.dataset.tag), ["国語", "数学", "英語", "生物", "化学", "物理", "社会", "情報", "その他"]);
  assert.deepEqual(chk().filter((c) => c.checked).map((c) => c.dataset.tag), ["国語", "数学", "英語", "化学", "物理", "その他"]);
  assert.ok(chk().every((c) => !c.disabled));
  await closeAll(); await p;
});

test("タグのページ: 選びを変えて「次へ」で反映(複数選択)。変えていなければ、反映の呼び出しはしない", async () => {
  let { api, p } = await open();
  await next(8);
  await next();                                                               // 変更なし
  assert.deepEqual(api.applied, []);
  assert.equal(title(), "注意事項");
  await closeAll(); await p;

  ({ api, p } = await open());
  await next(8);
  toggle("生物"); toggle("社会"); toggle("物理");                              // 生物・社会を足し、物理を外す
  await next();
  assert.deepEqual(api.applied, [["国語", "数学", "英語", "化学", "その他", "生物", "社会"].sort()].map((a) => a.sort()).length ? [api.applied[0]] : []);
  assert.deepEqual([...api.applied[0]].sort(), ["国語", "数学", "英語", "化学", "その他", "生物", "社会"].sort());
  assert.equal(title(), "注意事項");
  await closeAll(); await p;
});

test("タグのページ: 「戻る」でも反映する / 閉じる(×・Esc)だけでは反映しない", async () => {
  let { api, p } = await open();
  await next(8);
  toggle("情報");
  btn("prev").click(); await settle();
  assert.equal(title(), "設定");
  assert.deepEqual(api.applied.map((a) => a.includes("情報")), [true]);
  await closeAll(); await p;

  ({ api, p } = await open());
  await next(8);
  toggle("情報");
  await closeAll(); await p;
  assert.deepEqual(api.applied, [], "閉じただけなのに、反映した");
});

test("タグのページ: 反映に失敗したら、理由を出して、そのページに残る(次の操作でもう一度できる)", async () => {
  const { api, p } = await open({}, { applyResult: { ok: false, error: "選べるタグの名前ではありません" } });
  await next(8);
  toggle("生物");
  await next();
  assert.equal(title(), "タグ", "失敗したのに、先へ進んだ");
  const err = overlay().querySelector('[data-onb="tagErr"]');
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /タグを反映できませんでした/);
  assert.equal(btn("next").disabled, false);
  await closeAll(); await p;
  assert.equal(api.applied.length, 1);

  const t2 = await open({}, { applyResult: new Error("boom") });
  await next(8); toggle("生物"); await next();
  assert.equal(title(), "タグ");
  assert.match(overlay().querySelector('[data-onb="tagErr"]').textContent, /タグを反映できませんでした/);
  await closeAll(); await t2.p;
});

test("タグのページ: 使用中のタグは、チェック済みで外せない(「使用中」と表示)", async () => {
  const tags = ONBOARDING_TAGS.map((t) => ({ name: t.name, color: t.color, checked: t.name !== "生物", in_use: t.name === "数学" }));
  const { api, p } = await open({}, { tags });
  await next(8);
  const m = chk().find((c) => c.dataset.tag === "数学");
  assert.equal(m.checked, true); assert.equal(m.disabled, true);
  assert.match(m.closest("label").textContent, /使用中/);
  assert.ok(m.closest("label").classList.contains("locked"));
  assert.ok(!chk().find((c) => c.dataset.tag === "国語").disabled);
  toggle("生物"); await next();
  assert.ok(api.applied[0].includes("数学"), "使用中のタグが、選択から漏れた");
  await closeAll(); await p;
});

test("タグのページ: 読み込めなくても、案内は進められる(あとで設定から)", async () => {
  const api = fakeApi();
  api.get_onboarding_tags = async () => { throw new Error("x"); };
  const p = showOnboardingIfFirst(api);
  await settle();
  await next(8);
  assert.match(bodyEl().textContent, /タグの設定を読み込めませんでした/);
  assert.equal(chk().length, 0);
  await next();
  assert.equal(title(), "注意事項");
  assert.deepEqual(api.applied, []);
  await closeAll(); await p;
});

// ── 注意事項のページのインストール欄 ──
test("インストールの項目: 手順の文 → 合図が来たらボタン → 押すと案内を出す → インストール済みなら項目ごと隠す", async () => {
  const { p } = await open();
  await next(LAST);
  const sec = () => overlay().querySelector('[data-onb-sec="install"]');
  assert.equal(sec().hidden, false);
  assert.match(sec().textContent, /Chrome \/ Edge のアドレスバーの右/);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, true);

  let prompted = 0;
  const ev = new w.Event("beforeinstallprompt", { cancelable: true });
  ev.prompt = () => { prompted++; };
  ev.userChoice = Promise.resolve({ outcome: "accepted" });
  w.dispatchEvent(ev);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, false);
  assert.doesNotMatch(sec().textContent, /Chrome \/ Edge のアドレスバーの右/);
  btn("install").click();
  await settle();
  assert.equal(prompted, 1);
  assert.equal(overlay().querySelector('[data-onb="installAct"]').hidden, true);   // 案内を出したら、もうボタンは出さない
  await closeAll();
  await p;

  const prev = globalThis.matchMedia;                                            // すでにアプリとして開いている
  globalThis.matchMedia = (q) => ({ matches: /standalone/.test(q) });
  try {
    const p2 = showOnboarding(fakeApi(), { first: false });
    await settle();
    await next(LAST);
    assert.equal(sec().hidden, true);
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
    await next(LAST);
    assert.match(overlay().querySelector('[data-onb-sec="install"]').textContent, /共有ボタンから「ホーム画面に追加」/);
    await closeAll();
    await p;
  } finally { if (desc) Object.defineProperty(globalThis, "navigator", desc); else delete globalThis.navigator; }
});

// ── 3. 試験管理タブの入口(名前・日付を入れて開く) ──
test("試験管理タブ: openAddExam で、名前と日付が入った追加画面が開き、保存すると added:true・キャンセルすると added:false で解決する", async () => {
  const restore = setClock(NOW);
  try {
    const { proxy, api } = await realApi();
    const examView = await import("../ui/js/views/exam.js");
    assert.equal(examView.openAddExam({ name: "x", date: "2026-11-24" }), null, "表示していないのに、開いた");
    const root = document.createElement("div");
    document.body.appendChild(root);
    await examView.render(root, proxy);
    const val = (id) => root.querySelector(id).value;
    const open2 = () => examView.openAddExam({ name: SAMPLE_EXAM.name, date: SAMPLE_EXAM.date });

    let pr = open2();
    assert.ok(root.querySelector("#examOverlay").classList.contains("open"));
    assert.equal(val("#examName"), "２学期期末試験");
    assert.deepEqual([val("#examY"), val("#examM"), val("#examD")], ["2026", "11", "24"]);
    assert.equal(val("#examGoalHours"), "25");
    root.querySelector('#examOverlay [data-act="close"]').click();
    assert.deepEqual(await pr, { added: false });
    assert.equal(root.querySelector("#examOverlay").classList.contains("open"), false);
    assert.equal(api.get_exams().length, 0);

    // 年・月・日は、渡された日付のとおりに入る(今年とは違う年でも)
    pr = examView.openAddExam({ name: "別の試験", date: "2031-03-05" });
    assert.equal(val("#examName"), "別の試験");
    assert.deepEqual([val("#examY"), val("#examM"), val("#examD")], ["2031", "03", "05"]);
    root.querySelector('#examOverlay [data-act="close"]').click();
    await pr;

    pr = open2();
    root.querySelector("#examSaveBtn").click();
    assert.deepEqual(await pr, { added: true });
    assert.deepEqual(api.get_exams().map((e) => [e.name, e.date]), [["２学期期末試験", "2026-11-24"]]);

    // 画面の「＋ 試験を追加」ボタンは、今までどおり(空の名前・今日の日付)
    root.querySelector("#examAddBtn").click();
    assert.equal(val("#examName"), "");
    const t = new Date();                                                      // (試験管理タブは、共通の時計ではなく、実際の今日を使う)
    assert.deepEqual([val("#examY"), val("#examM"), val("#examD")], [String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, "0"), String(t.getDate()).padStart(2, "0")]);
    examView.onLeave();
    assert.equal(examView.openAddExam({}), null, "離れたあとも、開ける");
  } finally { restore(); }
});

// ── 4. 設定ページからの再表示 ──
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
    assert.equal(title(), "ホーム");
    await next(LAST);
    assert.equal(btn("next").textContent, "閉じる");
    btn("next").click();
    await settle();
    assert.equal(api.get_onboarding().done, false, "見直しただけで、見た印が付いた");

    root.querySelector("#onboardingBtn").click();
    await settle();
    await next(LAST);
    btn("backup").click();
    await settle();
    assert.deepEqual(scrolled, ["dataSect"]);
    assert.equal(api.get_onboarding().done, false);
  } finally { restore(); }
});

test("設定ページ → 案内 → タグの選び: 本物の API で、選んだとおりにタグが変わる(「次へ」で反映・閉じるだけでは変わらない)", async () => {
  const restore = setClock(NOW);
  try {
    const { proxy, api } = await realApi();
    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, proxy);
    const before = tagNames(api);

    root.querySelector("#onboardingBtn").click(); await settle();
    await next(8);
    toggle("生物"); toggle("物理");
    await closeAll();
    assert.deepEqual(tagNames(api), before, "閉じただけで、タグが変わった");

    root.querySelector("#onboardingBtn").click(); await settle();
    await next(8);
    toggle("生物"); toggle("物理");
    await next(); await tick(10);
    assert.deepEqual(tagNames(api), ["数学", "英語", "化学", "国語", "生物", "その他"]);
    await closeAll();
  } finally { restore(); }
});

// ── 5. 起動の順序・見た目の決まりごと ──
test("起動(app.js): 案内を先に出し、閉じたあとにバックアップのお知らせ。試験の追加も案内から呼べる", () => {
  const app = read("ui/js/app.js");
  const a = app.indexOf("showOnboardingIfFirst(api");
  const b = app.indexOf("showBackupBannerIfDue(api);");
  assert.ok(a > 0 && b > a, "案内より前に、バックアップのお知らせを出している");
  const between = app.slice(a - 40, b);
  assert.match(between, /await showOnboardingIfFirst/);
  assert.match(between, /catch/);
  assert.match(app, /onOpenBackup: openDataManagement, onAddExam: openExamAddFromGuide/);
  assert.match(app, /export async function openExamAddFromGuide/);
  assert.match(read("ui/js/views/settings.js"), /onAddExam: openExamAddFromGuide/);
});

test("見た目: 案内は、上下を固定して真ん中だけスクロールし、高さは一定(ページを変えても「次へ」が動かない)", () => {
  const css = read("ui/css/components.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.modal-box\.onb\{[^}]*height:560px; display:flex; flex-direction:column; overflow:hidden/);
  assert.match(css, /\.onb-body\{[^}]*min-height:0; overflow-y:auto/);
  assert.match(css, /\.onb-head\{[^}]*flex:none/);
  assert.match(css, /\.onb-foot\{[^}]*flex:none/);
  assert.match(css, /\.onb-chk input:checked \+ \.onb-chk-box\{/);
});

// ── 6. app.js ごと動かす: 試験タブを開く → 名前・日付つきの追加画面 → 閉じたら元のタブへ戻る ──
const until = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };
const activeTab = () => document.querySelector("#app .item.active")?.dataset.key;
const heading = () => document.querySelector("#content h1")?.textContent;
const examBox = (sel) => document.querySelector(`#content ${sel}`);

test("案内の「試しに追加」(app.js): 試験管理タブが開いて、名前と日付が入った追加画面が出る。閉じると、元のタブへ戻る(別のタブからでも)", async () => {
  const app = await import("../ui/js/app.js");
  await until(() => heading() === "ホーム", "最初のタブ(ホーム)");
  for (const start of ["home", "stats"]) {
    if (start !== "home") { await app.navigate(start); await until(() => heading() === "統計", "統計タブ"); }
    assert.equal(activeTab(), start);
    const p = app.openExamAddFromGuide({ name: SAMPLE_EXAM.name, date: SAMPLE_EXAM.date });
    await until(() => examBox("#examOverlay.open"), "追加画面");
    assert.equal(activeTab(), "exam");
    assert.equal(examBox("#examName").value, "２学期期末試験");
    assert.deepEqual([examBox("#examY").value, examBox("#examM").value, examBox("#examD").value], ["2026", "11", "24"]);
    examBox('#examOverlay [data-act="close"]').click();
    assert.deepEqual(await p, { added: false });
    await until(() => activeTab() === start, `${start} へ戻る`);
  }
  await app.navigate("home");
  await until(() => heading() === "ホーム", "ホームへ戻す");
});

test("案内 → 試験のページのボタン → 追加画面で保存 → 案内が同じページに戻り、ボタンは「追加しました」になる(本物の流れ)", async () => {
  const app = await import("../ui/js/app.js");
  await until(() => heading() === "ホーム", "ホーム");
  const api = fakeApi({ done: true });
  const p = showOnboarding(api, { first: false, onAddExam: app.openExamAddFromGuide });
  await settle();
  await next(4);
  assert.equal(title(), "試験管理");
  btn("exam").click();
  await until(() => examBox("#examOverlay.open"), "追加画面");
  assert.equal(anyOverlay(), null, "追加画面のあいだ、案内が隠れていない");
  assert.equal(examBox("#examName").value, "２学期期末試験");
  examBox("#examSaveBtn").click();
  await until(() => overlay() && activeTab() === "home", "案内に戻る・元のタブへ戻る");
  assert.equal(title(), "試験管理");
  assert.equal(btn("exam").disabled, true);
  assert.match(overlay().textContent, /追加しました/);
  await app.navigate("exam");                                                  // 本当に、試験が登録されている
  await until(() => document.querySelector("#content .exam-card .name")?.textContent === "２学期期末試験", "登録された試験");
  await app.navigate("home");
  await closeAll(); await p;
});
