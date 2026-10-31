// 設定ページの「このアプリについて」(版・インストール・更新の確認)。本物の API + jsdom。
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

const until = async (cond, what, ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } assert.fail(what); };

test("設定ページ: 開発版の表示・インストールの案内(ボタン → 案内 → インストール済み)・更新の確認は(開発版では)出ない", async () => {
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const { initInstall } = await import("../ui/js/components/install.js");
    initInstall(globalThis);
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const real = new Api(store);
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, api);

    assert.equal(root.querySelector("#buildId").textContent, "(開発版)");
    assert.equal(root.querySelector("#updateRow").hidden, true);                 // Service Worker を登録していない(開発版)ので、更新の確認は出さない
    assert.match(root.querySelector("#installRow").textContent, /Chrome \/ Edge のアドレスバーの右/);
    assert.equal(root.querySelector("#installBtn"), null);

    // ブラウザが「インストールできます」と知らせてきたら、ボタンになる
    let prompted = 0;
    const ev = new w.Event("beforeinstallprompt", { cancelable: true });
    ev.prompt = () => { prompted++; };
    ev.userChoice = Promise.resolve({ outcome: "accepted" });
    w.dispatchEvent(ev);
    const btn = await until(() => root.querySelector("#installBtn"), "インストールのボタン");
    assert.equal(btn.textContent, "アプリとしてインストール");
    assert.equal(ev.defaultPrevented, true);
    btn.click();
    await until(() => prompted === 1 && !root.querySelector("#installBtn"), "案内を出して、ボタンが消える");
  } finally { restore(); }
});
