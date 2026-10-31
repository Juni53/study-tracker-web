// タッチ中は、JS のホバー表示(星評価のプレビュー・カレンダーの吹き出し)を出さない。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { setupDom } from "./_dom.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = w.matchMedia.bind(w);
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const root = document.documentElement;
const over = (el) => el.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));

test("星評価: タッチ中はマウスイベントが来てもプレビューを出さず、タッチでなければ出る", async () => {
  const { mountStars } = await import("../ui/js/components/stars.js");
  const box = document.createElement("div");
  document.body.append(box);
  mountStars(box, { value: 2, onChange() {} });
  const stars = [...box.querySelectorAll(".star")];
  const cls = () => stars.map((s) => (s.classList.contains("on") ? "on" : s.classList.contains("pv") ? "pv" : "off")).join(",");

  root.classList.add("is-touch");
  over(stars[3]);
  assert.equal(cls(), "on,on,off,off,off");
  root.classList.remove("is-touch");
  over(stars[3]);
  assert.equal(cls(), "on,on,pv,pv,off");
  box.remove();
});

test("カレンダー: タッチ中はマウスイベントが来ても吹き出しを出さず、タッチでなければ出る", async () => {
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const real = new Api(store);
    real.add_record("2026-10-26", "1h", "テスト", [], [], "manual", 4, null);
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });
    const view = document.createElement("div");
    document.body.appendChild(view);
    await (await import("../ui/js/views/cal.js")).render(view, api);
    const cell = view.querySelector('.cal-cell[data-date="2026-10-26"]');
    const tip = () => document.querySelector(".cal-tip");
    assert.ok(cell && tip());

    root.classList.add("is-touch");
    over(cell);
    await sleep(250);
    assert.notEqual(tip().style.visibility, "visible", "タッチ中に吹き出しが出た");

    root.classList.remove("is-touch");
    over(cell);
    await sleep(250);
    assert.equal(tip().style.visibility, "visible", "タッチでなければ吹き出しが出るはず");
  } finally { restore(); }
});
