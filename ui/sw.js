// Study Tracker - Service Worker(オフライン対応と、更新の受け取り)
//
// ・公開用のビルド(tools/build-pwa.mjs)が、下の BUILD_ID と PRECACHE を書き換える。
//   BUILD_ID は、全ファイルの中身から決まる(中身が変われば、別の版になる)。
// ・インストール時に、アプリのファイルをすべて保存する。保存は cache:"reload" で、ブラウザの古い保存分は使わない
//   (GitHub Pages は、ファイルを10分ほどブラウザに保存させるため、古い版のファイルが混ざるのを防ぐ)。
// ・新しい版は「待機」させ、自動では切り替えない(画面から「更新する」が押されたときだけ切り替える)。
//   モジュール(import)の途中で版が入れ替わると、動かなくなるため。
// ・ページを開く要求は、アプリ本体(index.html)で返す。ファイルの要求は、保存したものを返す(ネットワークは使わない)。
// ・保存するのは、このアプリ自身のファイルだけ。学習データ(IndexedDB)には、一切触れない。

const BUILD_ID = "dev"; // @build
const PRECACHE = []; // @build

const CACHE_PREFIX = "study-tracker-";
const CACHE = CACHE_PREFIX + BUILD_ID;

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (path) => {
      const res = await fetch(new Request(path, { cache: "reload" }));
      if (!res.ok) throw new Error(`${path} を取得できません(${res.status})`);   // 1つでも失敗したら、この版はインストールしない(古い版のまま動く)
      await cache.put(path, res);
    }));
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX) && key !== CACHE) await caches.delete(key);   // 古い版の保存を消す
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;       // 他のサイトへの要求には関わらない
  event.respondWith(respond(req));
});

async function respond(req) {
  const cache = await caches.open(CACHE);
  if (req.mode === "navigate") {
    const shell = await cache.match(new URL("index.html", self.registration.scope).href);
    if (shell) return shell;
    return fetch(req);
  }
  const hit = await cache.match(req, { ignoreSearch: true });
  return hit || fetch(req);
}
