// 画面(views)が、実際の API(core/localApi.js)の戻り値で描画できることの確認(jsdom)。
// API の戻り値の形(null と undefined の違いなど)が、画面側の想定とずれていないかを見つける。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { setupDom } from "./_dom.js";

test("各ビューを、実際の API で描画できる(ホーム・カレンダー・統計・ショップ・設定)", async () => {
  // app.js が見る要素を含む index.html の本体で、DOM を作る(script は除く)
  const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
  setupDom(html);
  const w = window;
  for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.matchMedia = w.matchMedia.bind(w);
  globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const real = new Api(store);
    real.add_record("2026-10-26", "1h", "テスト", [1, 2], [], "manual", 4, null);
    real.add_record("2026-10-27", "45", "テスト2", [1], [], "stopwatch", 3, "09:10");
    real.add_exam("模試", "2026-11-10", 300);
    real.add_reward("本", 100);
    // 本物の入口(api.js)と同じく、引数と戻り値は複製して渡す
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });

    for (const name of ["home", "cal", "stats", "shop", "settings"]) {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const view = await import(`../ui/js/views/${name}.js`);
      await view.render(root, api);
      assert.ok(root.innerHTML.length > 500, `${name}: 描画された内容が少なすぎる`);
      if (view.onLeave) view.onLeave();
    }
  } finally { restore(); }
});
