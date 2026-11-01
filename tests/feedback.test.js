// 手順7: フィードバックタブ。URL が設定されているときだけ、設定タブの上に出る。渡すのは、(任意で)アプリのバージョンだけ。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { feedbackLink, parseFeedbackUrl } from "../ui/js/core/feedback.js";
import { buildNavItems } from "../ui/js/core/nav.js";
import { APP_VERSION, appVersionText } from "../ui/js/core/appInfo.js";
import * as config from "../ui/js/config.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const html = read("ui/index.html").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/viewform";
const V = "v3.0.0 (build abc123def456)";

// ── 設定ファイル ──
test("config.js: フォームの URL と、バージョンを渡す質問の番号を、文字列の定数として持つ(空でも、入っていても良い)", () => {
  assert.equal(typeof config.FEEDBACK_URL, "string");
  assert.equal(typeof config.FEEDBACK_VERSION_ENTRY, "string");
  assert.deepEqual(Object.keys(config).sort(), ["FEEDBACK_URL", "FEEDBACK_VERSION_ENTRY"], "config.js に、想定外の定数がある");
});

// ── リンクの作り方 ──
test("リンク: 空・空白・https でない値・読めない値は「設定なし」(null)。https の URL は通る", () => {
  for (const bad of ["", "   ", undefined, null, "http://example.com/form", "javascript:alert(1)", "forms.gle/abc", "//example.com/x", "https://", "ftp://example.com", "mailto:a@b.c", "データ"]) {
    assert.equal(parseFeedbackUrl(bad), null, `「${bad}」は使えない値`);
    // (feedbackLink の url を省く(undefined)と、config.js の値が使われる。実際の設定に左右されないよう、ここでは undefined は渡さない)
    if (bad !== undefined) assert.equal(feedbackLink({ url: bad, versionEntry: "entry.1", version: V }), null, `「${bad}」`);
  }
  const ok = feedbackLink({ url: `  ${FORM}  `, versionEntry: "", version: V });
  assert.deepEqual(ok, { href: FORM, withVersion: false, version: null });
});

test("リンク: 引数を省くと、config.js の値を使う(設定の中身が何でも、同じ規則で決まる)", () => {
  assert.deepEqual(feedbackLink(), feedbackLink({ url: config.FEEDBACK_URL, versionEntry: config.FEEDBACK_VERSION_ENTRY }));
  const r = feedbackLink();
  assert.ok(r === null || (new URL(r.href).protocol === "https:" && typeof r.withVersion === "boolean"));
});

test("リンク: バージョンの質問の番号(entry.数字)があれば、バージョンだけを入れる(usp=pp_url も付く・元の引数は残る)", () => {
  const r = feedbackLink({ url: FORM, versionEntry: "entry.1234567890", version: V });
  const u = new URL(r.href);
  assert.equal(r.withVersion, true);
  assert.equal(r.version, V);
  assert.equal(u.searchParams.get("entry.1234567890"), V);
  assert.equal(u.searchParams.get("usp"), "pp_url");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["entry.1234567890", "usp"]);
  assert.equal(u.origin + u.pathname, FORM, "宛先が変わっている");

  // Google の「事前入力したリンク」(usp と他の質問つき)を貼った場合: 他の引数は残し、バージョンの質問だけを足す/上書きする
  const pre = `${FORM}?usp=pp_url&entry.111=%E5%9B%BA%E5%AE%9A&entry.1234567890=old`;
  const r2 = new URL(feedbackLink({ url: pre, versionEntry: "entry.1234567890", version: V }).href);
  assert.equal(r2.searchParams.get("entry.111"), "固定");
  assert.equal(r2.searchParams.get("entry.1234567890"), V);
  assert.equal(r2.searchParams.getAll("usp").length, 1);
});

test("リンク: 質問の番号が entry.数字 の形でなければ、何も足さない(任意の名前のパラメータを混ぜない)", () => {
  for (const bad of ["", "  ", "foo", "entry.", "entry.abc", "entry.12 3", "usp", "entry.1&x=1", "ENTRY.1", "entry.1 &x=1"]) {
    const r = feedbackLink({ url: FORM, versionEntry: bad, version: V });
    assert.deepEqual(r, { href: FORM, withVersion: false, version: null }, `「${bad}」`);
  }
  // 前後の空白・改行は、貼り付けのときに入りやすいので、取り除いて使う
  assert.equal(feedbackLink({ url: FORM, versionEntry: " entry.7\n", version: V }).withVersion, true);
});

test("リンク: 渡す値は「バージョン」だけ。学習データ(記録・ポイント・タグ・設定)の名前は、リンクを作る処理に出てこない", () => {
  const src = read("ui/js/core/feedback.js").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /records|points|tags|exams|rewards|settings|store|localStorage|indexedDB|api\b/i, "学習データに触れている");
  const r = feedbackLink({ url: FORM, versionEntry: "entry.9", version: appVersionText("abc123") });
  assert.equal(new URL(r.href).searchParams.get("entry.9"), `${APP_VERSION} (build abc123)`);
  assert.equal(appVersionText("dev"), `${APP_VERSION} (開発版)`);
});

// ── ナビ ──
test("ナビ: 設定がないときは、いままでどおり(フィードバックなし)。あるときは、設定の1つ上(余白のあと)に入る", () => {
  const off = buildNavItems({ feedback: false }).map((n) => n.key);
  assert.deepEqual(off, ["home", "timer", "log", "cal", "exam", "stats", "shop", "spacer", "settings"]);
  assert.deepEqual(buildNavItems().map((n) => n.key), off, "引数なしは「なし」");
  const items = buildNavItems({ feedback: true });
  assert.deepEqual(items.map((n) => n.key), ["home", "timer", "log", "cal", "exam", "stats", "shop", "spacer", "feedback", "settings"]);
  const fb = items.find((n) => n.key === "feedback");
  assert.deepEqual([fb.icon, fb.label], ["chat", "フィードバック"]);
  assert.equal(items.at(-1).key, "settings", "設定が、いちばん下でなくなった");
});

test("ナビ(app.js): いまの config.js の設定と、画面のタブの有無が一致する(URL を入れれば出る・空なら出ない)", async () => {
  await import("../ui/js/app.js");
  await tick(); await tick();
  const has = !!document.querySelector('#items .item[data-key="feedback"]');
  assert.equal(has, feedbackLink() !== null);
  const keys = [...document.querySelectorAll("#items .item")].map((e) => e.dataset.key);
  assert.equal(keys.at(-1), "settings");
  if (has) assert.equal(keys.at(-2), "feedback");
  const app = read("ui/js/app.js");
  assert.match(app, /buildNavItems\(\{ feedback: feedbackOn \}\)/);
  assert.match(app, /chat: '<path/);
  assert.match(app, /FEEDBACK_URL\.trim\(\) && !feedbackOn/);
});

// ── 画面 ──
const examineView = async (link) => {
  const { render } = await import("../ui/js/views/feedback.js");
  const root = document.createElement("div");
  document.body.appendChild(root);
  await render(root, {}, { link });
  return root;
};

test("画面: お願いの文章と、フォームへのリンク(別タブ・noopener noreferrer)。バージョンを渡さないときは、その説明は出さない", async () => {
  const root = await examineView({ href: FORM, withVersion: false, version: null });
  assert.equal(root.querySelector("h1").textContent, "フィードバック");
  const a = root.querySelector("a#fbLink");
  assert.equal(a.getAttribute("href"), FORM);
  assert.equal(a.getAttribute("target"), "_blank");
  assert.deepEqual(a.getAttribute("rel").split(/\s+/).sort(), ["noopener", "noreferrer"]);
  assert.equal(a.textContent, "フィードバックのフォームを開く");
  assert.match(root.textContent, /ご意見・ご要望/);
  assert.match(root.textContent, /記録や設定は、送られません/);
  assert.doesNotMatch(root.textContent, /バージョン\(/);
  assert.equal(root.querySelectorAll("a").length, 1);
});

test("画面: バージョンを渡すときは、「渡すのはバージョンだけ」と、その値を表示する。HTML として解釈されるものは入らない", async () => {
  const root = await examineView({ href: `${FORM}?usp=pp_url&entry.1=${encodeURIComponent(V)}`, withVersion: true, version: V });
  assert.match(root.textContent, /アプリのバージョン\(v3\.0\.0 \(build abc123def456\)\)だけが/);
  assert.match(root.textContent, /記録や設定は、送られません/);
  const evil = await examineView({ href: `${FORM}?x="><img src=x onerror=alert(1)>`, withVersion: true, version: "<b>v</b>" });
  assert.equal(evil.querySelectorAll("img").length, 0);
  assert.equal(evil.querySelectorAll("b").length, 0, "バージョンの文字が、HTML として入っている");
  assert.equal(evil.querySelectorAll("a").length, 1);
});

test("画面: 宛先が無いときは、リンクを出さず、その旨だけ出す", async () => {
  const root = await examineView(null);
  assert.equal(root.querySelectorAll("a").length, 0);
  assert.match(root.textContent, /宛先が設定されていません/);
});

// ── 案内(はじめに)の文 ──
test("案内の「プライバシー」: フィードバックのリンクがあるときだけ、「外へ出るのはリンクを開いたときだけ」を足す(バージョンを渡すなら、そのことも)", async () => {
  const { PAGES } = await import("../ui/js/components/onboarding.js");
  const notes = PAGES.at(-1);
  const privacy = (feedback) => {
    const d = document.createElement("div");
    d.innerHTML = notes.html({ first: true, feedback });
    return d.querySelector('[data-onb-sec="privacy"]').textContent;
  };
  assert.doesNotMatch(privacy(null), /フィードバック/);
  assert.match(privacy(null), /外部のサーバーへ送られません/);
  const a = privacy({ href: FORM, withVersion: false });
  assert.match(a, /「フィードバック」タブのリンクを開いたときだけ/);
  assert.doesNotMatch(a, /バージョンだけが/);
  assert.match(privacy({ href: FORM, withVersion: true, version: V }), /アプリのバージョンだけがフォームに渡されます/);
});

// ── 設定ページの版の表記 ──
test("設定ページ: バージョンの表記は appInfo.js の値を使う(直書きしない)", () => {
  const s = read("ui/js/views/settings.js");
  assert.match(s, /バージョン <b>\$\{APP_VERSION\}<\/b>/);
  assert.doesNotMatch(s, /v3\.0\.0/);
});
