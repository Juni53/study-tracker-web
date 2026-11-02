// 日付が変わったとき・計測中の再読み込み: app.js ごと動かして確かめる(jsdom)。
// 時計を進めながら、さぼり券が使われるか(= 起動時処理がやり直されたか)・画面が描き直されたか・お知らせが出るかを見る。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setupDom, tick } from "./_dom.js";
import { setClock } from "../ui/js/core/dates.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const NOW = { d: new Date(2026, 10, 10, 10, 0, 0) };                 // 2026-11-10 10:00(テストから進める)
setClock(() => NOW.d);
const goTo = (m, d, h = 10) => { NOW.d = new Date(2026, m - 1, d, h, 0, 0); };

const { api } = await import("../ui/js/api.js");
const { stopwatch } = await import("../ui/js/store/stopwatch.js");
await import("../ui/js/app.js");

const until = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };
const h1 = () => document.querySelector("#content h1");
const owned = async () => (await api.get_shop()).sabori.owned;
const wake = () => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new window.Event("visibilitychange")); };
const notice = () => document.querySelector(".day-notice");

// 準備: 11/8〜11/10 に16時間ずつ勉強(ポイントをためる)→ さぼり券を2枚買う
await until(() => h1()?.textContent === "ホーム", "ホーム");
await api.add_record("2026-11-09", "16h", "x", [], [], "manual", 3, null);
await api.add_record("2026-11-10", "16h", "x", [], [], "manual", 3, null);
await api.add_record("2026-11-08", "16h", "x", [], [], "manual", 3, null);
const buyTwo = async () => { for (let i = 0; i < 2; i++) assert.equal((await api.buy_sabori_ticket()).ok, true); };
await buyTwo();
assert.equal(await owned(), 2);

test("日付が変わったら(開いたまま)、起動時処理がやり直されて(さぼり券が使われる)、画面が描き直される", async () => {
  const before = h1();
  goTo(11, 13);                                      // 3日後。11/11・11/12 は、勉強なし(アプリは開いたまま)
  wake();
  await until(() => h1() && h1() !== before, "画面の描き直し");
  assert.equal(h1().textContent, "ホーム", "描き直したあとの画面が違う");
  assert.equal(await owned(), 0, "さぼり券が使われていない(起動時処理がやり直されていない)");
  assert.equal(notice(), null);
});

test("ストップウォッチが動いている間は、保留して、お知らせを出す。計測を止めると(リセット)、自動で更新する", async () => {
  await buyTwo();
  const before = h1();
  goTo(11, 16);                                      // 11/14・11/15 が、勉強なし
  stopwatch.start();
  wake();
  await until(() => notice(), "お知らせ");
  assert.match(notice().textContent, /ストップウォッチの計測中のため、更新を保留しています/);
  await tick(150);
  assert.equal(await owned(), 2, "計測中なのに、さぼり券が使われた");
  assert.equal(h1(), before, "計測中なのに、画面が描き直された");

  stopwatch.reset();                                 // 計測を止める
  await until(async () => (await owned()) === 0, "起動時処理のやり直し").catch(() => {});
  await until(() => h1() !== before, "画面の描き直し");
  assert.equal(await owned(), 0);
  assert.equal(notice(), null, "処理が済んだのに、お知らせが残っている");
});

test("ポップアップが開いている間は、起動時処理は進めるが、画面は描き直さない。閉じて、もう一度見たら、描き直す", async () => {
  await buyTwo();
  const before = h1();
  const modal = document.createElement("div");
  modal.className = "modal-overlay open";
  document.body.appendChild(modal);
  goTo(11, 19);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  assert.equal(await owned(), 0, "起動時処理が進まない");
  await tick(100);
  assert.equal(h1(), before, "ポップアップが開いているのに、画面が描き直された");
  modal.remove();
  wake();
  await until(() => h1() !== before, "ポップアップを閉じたあとの描き直し");
});

test("タブを切り替えたあとは、もう描き直さない(新しい日付で描かれているため)", async () => {
  await api.buy_sabori_ticket();
  const modal = document.createElement("div");
  modal.className = "modal-overlay open";
  document.body.appendChild(modal);
  goTo(11, 22);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  document.querySelector('#items .item[data-key="stats"]').click();         // 使用中に、別のタブへ
  await until(() => h1()?.textContent === "統計", "統計タブ");
  const statsH1 = h1();
  modal.remove();
  wake();
  await tick(200);
  assert.equal(h1(), statsH1, "切り替え済みなのに、もう一度描き直した");
  document.querySelector('#items .item[data-key="home"]').click();
  await until(() => h1()?.textContent === "ホーム", "ホーム");
});

test("入力欄に入力している最中は、起動時処理は進めるが、画面は描き直さない。入力が終わったら、描き直す", async () => {
  await api.buy_sabori_ticket();
  const before = h1();
  const input = document.createElement("input");
  document.querySelector("#content").appendChild(input);
  input.focus();
  assert.equal(document.activeElement, input);
  goTo(11, 25);
  wake();
  let n = 0;
  while ((await owned()) !== 0 && n++ < 200) await tick(10);
  assert.equal(await owned(), 0, "起動時処理が進まない");
  await tick(100);
  assert.equal(h1(), before, "入力中なのに、画面が描き直された(入力が消える)");
  input.blur();
  wake();
  await until(() => h1() !== before, "入力が終わったあとの描き直し");
});

test("計測の途中に再読み込みしようとすると、ブラウザの確認が出る(beforeunload)。計測が無ければ出ない", () => {
  stopwatch.reset(); stopwatch.pomodoroReset();
  const ask = () => { const ev = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(ev); return ev; };
  assert.equal(ask().defaultPrevented, false, "計測が無いのに、確認が出る");
  stopwatch.start();
  try {
    const ev = ask();
    assert.equal(ev.defaultPrevented, true, "計測中なのに、確認が出ない");
    stopwatch.pause();
    assert.equal(ask().defaultPrevented, true, "一時停止中(未保存)でも、確認が出る");
  } finally { stopwatch.reset(); }
  assert.equal(ask().defaultPrevented, false);
});
