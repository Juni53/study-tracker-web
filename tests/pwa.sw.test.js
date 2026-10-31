// Service Worker(ui/sw.js をビルドしたもの)の動作を、偽の実行環境(self・caches・fetch)の中で確かめる。
// 実際のブラウザでの動作(オフライン起動・更新)は、実機で確認すること。
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../tools/build-pwa.mjs";

const UI = new URL("../ui", import.meta.url).pathname;
const SCOPE = "https://juni53.github.io/study-tracker-web/";

const root = mkdtempSync(join(tmpdir(), "st-sw-"));
const built = build({ dir: UI, out: join(root, "dist") });
const builtSrc = readFileSync(join(root, "dist/sw.js"), "utf8");
const devSrc = readFileSync(join(UI, "sw.js"), "utf8");
test.after(() => rmSync(root, { recursive: true, force: true }));

function makeCaches() {
  const stores = new Map();
  const norm = (u, ignoreSearch) => { const x = new URL(typeof u === "string" ? u : u.url, SCOPE); if (ignoreSearch) x.search = ""; return x.href; };
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (k, res) => { m.set(norm(k), res); },
      match: async (k, opts = {}) => {
        const want = norm(k, opts.ignoreSearch);
        for (const [key, res] of m) if (norm(key, opts.ignoreSearch) === want) return res.clone();
        return undefined;
      },
    };
  };
  return { stores, open, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) };
}

function loadSw(source, { fetchImpl, caches = makeCaches() } = {}) {
  const handlers = {};
  const log = { claimed: 0, skipped: 0, fetches: [] };
  const self = {
    location: new URL(SCOPE + "sw.js"), registration: { scope: SCOPE },
    addEventListener: (t, f) => (handlers[t] ||= []).push(f),
    clients: { claim: async () => { log.claimed++; } },
    skipWaiting: () => { log.skipped++; },
  };
  class Req extends Request { constructor(u, init) { super(typeof u === "string" ? new URL(u, SCOPE).href : u, init); } }
  const fetchFn = async (req) => { log.fetches.push(req); return fetchImpl(req); };
  vm.runInNewContext(source, { self, caches, fetch: fetchFn, Request: Req, Response, URL, Promise, Error, console });
  const run = async (type, ev = {}) => {
    let p;
    const event = { ...ev, waitUntil: (x) => { p = x; }, respondWith: (x) => { event.responded = x; } };
    (handlers[type] || []).forEach((f) => f(event));
    if (p) await p;
    return event;
  };
  return { run, log, caches, handlers };
}
const okFetch = async (req) => new Response(`net:${new URL(req.url).pathname.replace("/study-tracker-web/", "")}`);
const bodyOf = async (event) => (await event.responded).text();
const GET = (path, extra = {}) => ({ request: { url: new URL(path, SCOPE).href, method: "GET", mode: "no-cors", ...extra } });

// ── install ──
test("install: 全ファイルを、ブラウザの古い保存分を使わずに取得して保存する。自動では切り替えない", async () => {
  const sw = loadSw(builtSrc, { fetchImpl: okFetch });
  await sw.run("install");
  assert.equal(sw.log.fetches.length, built.files.length);
  assert.ok(sw.log.fetches.every((r) => r.cache === "reload"), "cache:'reload' で取得する");
  const [name] = [...sw.caches.stores.keys()];
  assert.equal(name, `study-tracker-${built.buildId}`);
  assert.equal(sw.caches.stores.get(name).size, built.files.length);
  assert.equal(sw.log.skipped, 0);
});

test("install: 1つでも取得できなければ、インストールは失敗する(古い版のまま動き続ける)", async () => {
  const sw = loadSw(builtSrc, { fetchImpl: async (req) => (req.url.endsWith("js/app.js") ? new Response("no", { status: 404 }) : okFetch(req)) });
  await assert.rejects(sw.run("install"), /js\/app\.js/);
  const sw2 = loadSw(builtSrc, { fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(sw2.run("install"));
});

// ── fetch ──
async function installed() {
  const sw = loadSw(builtSrc, { fetchImpl: okFetch });
  await sw.run("install");
  sw.log.fetches.length = 0;
  return sw;
}

test("fetch: 保存したファイルは、ネットワークを使わずに返す(クエリが付いていても)", async () => {
  const sw = await installed();
  for (const path of ["css/tokens.css", "js/app.js?v=1", "icons/icon-192.png"]) {
    const ev = await sw.run("fetch", GET(path));
    assert.ok(ev.responded, path);
    assert.equal(await bodyOf(ev), `net:${path.split("?")[0]}`);
  }
  assert.equal(sw.log.fetches.length, 0);
});

test("fetch: ページを開く要求は、どの URL でもアプリ本体(index.html)を返す", async () => {
  const sw = await installed();
  for (const path of ["", "?x=1", "some/deep/path", "index.html"]) {
    const ev = await sw.run("fetch", GET(path, { mode: "navigate" }));
    assert.equal(await bodyOf(ev), "net:index.html", path || "(ルート)");
  }
  assert.equal(sw.log.fetches.length, 0);
});

test("fetch: オフラインでも、保存したファイルとページは返せる。保存していないものは失敗する", async () => {
  const sw = loadSw(builtSrc, { fetchImpl: okFetch });
  await sw.run("install");
  sw.handlers.fetch.length = 0;                        // (同じ環境のまま、ネットワークだけ切るため、新しく読み込み直す)
  const offline = loadSw(builtSrc, { fetchImpl: async () => { throw new TypeError("offline"); }, caches: sw.caches });
  assert.equal(await bodyOf(await offline.run("fetch", GET("js/core/localApi.js"))), "net:js/core/localApi.js");
  assert.equal(await bodyOf(await offline.run("fetch", GET("", { mode: "navigate" }))), "net:index.html");
  await assert.rejects(bodyOf(await offline.run("fetch", GET("not-cached.js"))));
});

test("fetch: 保存していない同じサイトのファイルは、ネットワークから取る", async () => {
  const sw = await installed();
  assert.equal(await bodyOf(await sw.run("fetch", GET("extra.json"))), "net:extra.json");
  assert.equal(sw.log.fetches.length, 1);
});

test("fetch: 他のサイトへの要求・GET 以外には関わらない", async () => {
  const sw = await installed();
  const cross = await sw.run("fetch", { request: { url: "https://example.com/a.js", method: "GET", mode: "no-cors" } });
  assert.equal(cross.responded, undefined);
  const post = await sw.run("fetch", GET("css/tokens.css", { method: "POST" }));
  assert.equal(post.responded, undefined);
});

// ── activate / message ──
test("activate: 古い版の保存だけを消す(他のアプリの保存は消さない)。すぐ制御を引き継ぐ", async () => {
  const caches = makeCaches();
  for (const n of ["study-tracker-old1", "study-tracker-old2", "other-app-cache", `study-tracker-${built.buildId}`]) await caches.open(n);
  const sw = loadSw(builtSrc, { fetchImpl: okFetch, caches });
  await sw.run("activate");
  assert.deepEqual([...caches.stores.keys()].sort(), [`study-tracker-${built.buildId}`, "other-app-cache"].sort());
  assert.equal(sw.log.claimed, 1);
});

test("message: SKIP_WAITING のときだけ、新しい版に切り替える", async () => {
  const sw = loadSw(builtSrc, { fetchImpl: okFetch });
  await sw.run("message", { data: { type: "SOMETHING_ELSE" } });
  await sw.run("message", { data: null });
  assert.equal(sw.log.skipped, 0);
  await sw.run("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(sw.log.skipped, 1);
});

// ── 開発版(ビルド前の ui/sw.js) ──
test("開発版の sw.js(保存の一覧が空)は、何も保存せず、すべてネットワークから取る", async () => {
  const sw = loadSw(devSrc, { fetchImpl: okFetch });
  await sw.run("install");
  assert.equal(sw.log.fetches.length, 0);
  assert.equal(await bodyOf(await sw.run("fetch", GET("", { mode: "navigate" }))), "net:");
  assert.equal(await bodyOf(await sw.run("fetch", GET("js/app.js"))), "net:js/app.js");
});
