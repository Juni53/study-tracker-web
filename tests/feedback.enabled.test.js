// 手順7(URL を設定した場合): ui/ を一時フォルダへコピーして config.js だけ書き換え、その app.js を動かす。
// → 設定タブの上に「フィードバック」タブが出て、開くとフォームへのリンク(バージョンだけを入れた形)が出る。
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { setupDom, tick } from "./_dom.js";

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSfBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/viewform?usp=pp_url&entry.111=%E5%9B%BA%E5%AE%9A";
const tmp = mkdtempSync(join(tmpdir(), "st-fb-"));
cpSync(new URL("../ui", import.meta.url).pathname, tmp, { recursive: true });
writeFileSync(join(tmp, "js/config.js"), `export const FEEDBACK_URL = ${JSON.stringify(FORM)};\nexport const FEEDBACK_VERSION_ENTRY = "entry.555";\n`);

const html = readFileSync(join(tmp, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const until = async (cond, what, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await tick(10); } assert.fail(`待っても起きませんでした: ${what}`); };

test("URL を設定すると、設定タブの上に「フィードバック」が出て、開くと、バージョンだけを入れたリンクが出る", async () => {
  await import(pathToFileURL(join(tmp, "js/app.js")).href);
  await until(() => document.querySelector("#content h1")?.textContent === "ホーム", "ホーム");
  const keys = [...document.querySelectorAll("#items .item")].map((e) => e.dataset.key);
  assert.deepEqual(keys, ["home", "timer", "log", "cal", "exam", "stats", "shop", "feedback", "settings"]);
  const item = document.querySelector('#items .item[data-key="feedback"]');
  assert.equal(item.querySelector(".lbl").textContent, "フィードバック");
  assert.ok(item.querySelector("svg path"), "アイコンが無い");

  item.click();
  await until(() => document.querySelector("#content h1")?.textContent === "フィードバック", "フィードバックの画面");
  assert.equal(document.querySelector("#items .item.active").dataset.key, "feedback");
  const a = document.querySelector("#content a#fbLink");
  const u = new URL(a.getAttribute("href"));
  assert.equal(u.origin + u.pathname, new URL(FORM).origin + new URL(FORM).pathname);
  assert.equal(u.searchParams.get("entry.111"), "固定", "元の引数が消えた");
  assert.equal(u.searchParams.get("entry.555"), "v3.0.0 (開発版)");
  assert.deepEqual([...u.searchParams.keys()].sort(), ["entry.111", "entry.555", "usp"]);
  assert.equal(a.target, "_blank");
  assert.match(document.querySelector("#content").textContent, /アプリのバージョン\(v3\.0\.0 \(開発版\)\)だけが/);

  // 設定タブへ移って、戻れる(他のタブと同じに動く)
  document.querySelector('#items .item[data-key="settings"]').click();
  await until(() => document.querySelector("#content h1")?.textContent === "設定", "設定の画面");
  assert.match(document.querySelector("#content").textContent, /バージョン\s*v3\.0\.0/);
});
