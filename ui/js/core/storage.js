// 保存層。Python 版の「AppData の JSON ファイル」に相当する。
//
// 設計:
//  ・11 個の JSON ファイルを、ファイル名をキーにして IndexedDB の 1 つのストアへ「そのまま」保存する。
//    (Python 版と同じ「ファイル単位で全部読み書き」なので、移植が機械的になり、バックアップも作りやすい。)
//  ・起動時に全部をメモリへ読み込む。以降の get() / save() は同期。IndexedDB への書き込みは裏で行う。
//  ・save() は、その時点の中身のコピーを保存する(Python の jsave が即座に書き出すのと同じ意味になる)。
//  ・同じファイルへの書き込みが続いたときは、最新の1つにまとめて書く。
//  ・書き込みが失敗しても、メモリのデータは捨てない。次の save() / flush() で再試行する。
//  ・IndexedDB が使えない環境(プライベートモードなど)では、メモリだけで動く(volatile: true)。
//    その場合は画面で「この環境ではデータが保存されません」と知らせること。

const DB_NAME = "study-tracker";
const DB_VERSION = 1;
const FILES = "files";
const META = "meta";

const asPromise = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const txDone = (tx) => new Promise((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error || new Error("transaction aborted"));
});

function openDb(idb, name) {
  return new Promise((resolve, reject) => {
    const req = idb.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class StorageFrozenError extends Error {
  constructor() { super("このタブは別のタブに引き継がれたため、保存できません"); this.name = "StorageFrozenError"; }
}

export async function openStorage({ indexedDB: idb = globalThis.indexedDB, dbName = DB_NAME } = {}) {
  let db = null;
  let openError = null;
  if (idb) {
    try { db = await openDb(idb, dbName); } catch (e) { openError = e; }
  }
  const volatile = !db;
  if (db) db.onversionchange = () => db.close();

  const cache = new Map();      // ファイル名 → 中身(メモリ上の本体)
  const known = new Set();      // 保存済み(または保存を依頼済み)のファイル名
  const metaCache = new Map();

  if (db) {
    const tx = db.transaction([FILES, META], "readonly");
    const fs = tx.objectStore(FILES), ms = tx.objectStore(META);
    const [fk, fv, mk, mv] = await Promise.all([asPromise(fs.getAllKeys()), asPromise(fs.getAll()), asPromise(ms.getAllKeys()), asPromise(ms.getAll())]);
    fk.forEach((k, i) => { cache.set(k, fv[i]); known.add(k); });
    mk.forEach((k, i) => metaCache.set(k, mv[i]));
  }

  const pending = new Map();    // 書き込み待ち。"f:名前" / "m:名前" → {store, key, value}
  let flushing = null;
  let lastError = null;
  let frozen = false;
  const errorListeners = new Set();

  async function runFlush() {
    while (pending.size) {
      const batch = [...pending.entries()];
      try {
        const tx = db.transaction([FILES, META], "readwrite");
        for (const [, w] of batch) tx.objectStore(w.store).put(w.value, w.key);
        await txDone(tx);
      } catch (e) {
        lastError = e;
        errorListeners.forEach((fn) => { try { fn(e); } catch { /* 通知側の失敗は無視 */ } });
        return;                  // 待ち行列は残す(次の save / flush で再試行)
      }
      lastError = null;
      for (const [id, w] of batch) if (pending.get(id) === w) pending.delete(id);   // 書いている間に更新されたものは残す
    }
  }
  const kick = () => (flushing ??= runFlush().finally(() => { flushing = null; }));

  function enqueue(id, store, key, value) {
    if (volatile) return;
    pending.set(id, { store, key, value: structuredClone(value) });
    kick();
  }
  const guard = () => { if (frozen) throw new StorageFrozenError(); };

  return {
    volatile,
    openError,
    _db: db,                                   // テスト用

    // ファイルの中身を返す(同期)。まだ無ければ既定値を作ってメモリに置く(保存はしない)。
    get(name, makeDefault) {
      if (!cache.has(name)) cache.set(name, typeof makeDefault === "function" ? makeDefault() : structuredClone(makeDefault));
      return cache.get(name);
    },
    has: (name) => known.has(name),
    names: () => [...known],

    // 保存する。value を省くと、get() で取り出して書き換えた本体を保存する。
    save(name, value = cache.get(name)) {
      guard();
      if (value === undefined) throw new Error(`保存する中身がありません: ${name}`);
      cache.set(name, value);
      known.add(name);
      enqueue(`f:${name}`, FILES, name, value);
    },

    getMeta: (key, fallback = null) => (metaCache.has(key) ? metaCache.get(key) : fallback),
    setMeta(key, value) {
      guard();
      metaCache.set(key, value);
      enqueue(`m:${key}`, META, key, value);
    },

    // 保存済みのファイルすべてのコピー(バックアップ用)
    exportAll() {
      const out = {};
      for (const name of known) out[name] = structuredClone(cache.get(name));
      return out;
    },

    // 書き込みが全部終わるまで待つ。失敗していれば例外。
    async flush() {
      while (pending.size) {
        if (volatile) { pending.clear(); break; }
        await kick();
        if (lastError) throw lastError;
      }
    },

    // 保存するファイルを、まるごと入れ替える(バックアップからの復元用)。まず書き込み待ちを終え、
    // IndexedDB は1回の取引(トランザクション)で入れ替えるので、途中で失敗しても、元のデータが残る。
    // メタ情報(バックアップの設定など)は、そのまま。
    async replaceFiles(files) {
      guard();
      await this.flush();
      const next = structuredClone(files);
      if (db) {
        const tx = db.transaction([FILES], "readwrite");
        const os = tx.objectStore(FILES);
        os.clear();
        for (const [name, value] of Object.entries(next)) os.put(value, name);
        await txDone(tx);
      }
      cache.clear(); known.clear();
      for (const [name, value] of Object.entries(next)) { cache.set(name, value); known.add(name); }
    },

    async clearAll() {
      guard();
      pending.clear();
      if (flushing) await flushing;
      cache.clear(); known.clear(); metaCache.clear();
      if (db) {
        const tx = db.transaction([FILES, META], "readwrite");
        tx.objectStore(FILES).clear();
        tx.objectStore(META).clear();
        await txDone(tx);
      }
    },

    status: () => ({ volatile, pending: pending.size, lastError, frozen }),
    onError(fn) { errorListeners.add(fn); return () => errorListeners.delete(fn); },

    // 別のタブに引き継がれたとき、このタブからの書き込みを止める(古いデータで上書きしないため)
    freeze() { frozen = true; pending.clear(); },
    close() { if (db) db.close(); },
  };
}

// ブラウザによる自動削除を避けるため、永続化を要求する。許可されるかどうかはブラウザ次第。
export async function requestPersistence(nav = globalThis.navigator) {
  const s = nav && nav.storage;
  if (!s || !s.persist) return { supported: false, persisted: false };
  try {
    let persisted = s.persisted ? await s.persisted() : false;
    if (!persisted) persisted = await s.persist();
    return { supported: true, persisted: !!persisted };
  } catch (e) {
    return { supported: true, persisted: false, error: String(e) };
  }
}

export async function storageEstimate(nav = globalThis.navigator) {
  try {
    const e = await nav.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch { return null; }
}
