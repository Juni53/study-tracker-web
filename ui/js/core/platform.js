// ブラウザ固有の機能(ダウンロード・ファイル選択・通知・画面消灯防止・再読み込み・保存容量)。
// データの処理(core の他のファイル)から切り離してあるので、Node でテストでき、機能が使えない環境でも落ちない。
// env を差し替えて、テストでは偽物のブラウザ(document / Notification / navigator など)を渡す。

const MAX_FILE_BYTES = 20 * 1024 * 1024;

// ブラウザ以外(テストなど)で使う、何もしない実装
export const unsupportedPlatform = {
  download() { return { ok: false, error: "この環境ではダウンロードできません" }; },
  async saveFile() { return { ok: false, error: "この環境では保存できません" }; },
  savePickerSupported() { return false; },
  async pickFile() { return null; },
  notificationPermission() { return "unsupported"; },
  async requestNotificationPermission() { return "unsupported"; },
  async notify() { return { ok: false, reason: "unsupported" }; },
  async setWakeLock() { return { ok: false, active: false, error: "unsupported" }; },
  reload() {},
  async storageEstimate() { return null; },
};

export function createBrowserPlatform(env = globalThis) {
  const doc = env.document;
  const nav = env.navigator;

  // ── ダウンロード ──
  function download(filename, text, mime = "text/csv;charset=utf-8") {
    const blob = new env.Blob([text], { type: mime });
    const url = env.URL.createObjectURL(blob);
    const a = doc.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    doc.body.appendChild(a);
    a.click();
    a.remove();
    env.setTimeout(() => env.URL.revokeObjectURL(url), 30000);
    return { ok: true, filename };
  }

  // ── 保存先を選んで保存(File System Access API。Chrome / Edge) ──
  // 使えない環境(Firefox・Safari・http のアドレス・iframe)では、通常のダウンロードにする。
  // 戻り値: {ok:true, filename, method:"picker"|"download"} / 選ばずに閉じたら {ok:true, cancelled:true} / {ok:false, error}
  async function saveFile(filename, text, mime = "application/json") {
    if (typeof env.showSaveFilePicker === "function") {
      try {
        const handle = await env.showSaveFilePicker({
          suggestedName: filename,
          id: "study-tracker-backup",                           // 次回は、前回選んだフォルダから始まる
          types: [{ description: "Study Tracker バックアップ", accept: { "application/json": [".json"] } }],
        });
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        return { ok: true, filename: handle.name, method: "picker" };
      } catch (e) {
        if (e && e.name === "AbortError") return { ok: true, cancelled: true };
        if (!(e && (e.name === "SecurityError" || e.name === "NotAllowedError" || e.name === "TypeError"))) return { ok: false, error: String(e && e.message || e) };
        // 保存先を選べない状況(操作の直後でない・埋め込み表示など)は、ダウンロードにする
      }
    }
    return { ...download(filename, text, mime), method: "download" };
  }

  // ── ファイル選択 → {name, bytes} / 選ばなければ null ──
  function pickFile({ accept = "" } = {}) {
    return new Promise((resolve, reject) => {
      const input = doc.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";
      let settled = false;
      const finish = (fn, v) => { if (settled) return; settled = true; input.remove(); fn(v); };
      input.addEventListener("change", async () => {
        const file = input.files && input.files[0];
        if (!file) return finish(resolve, null);
        if (file.size > MAX_FILE_BYTES) return finish(reject, new Error("ファイルが大きすぎます(20MBまで)"));
        try { finish(resolve, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }); }
        catch (e) { finish(reject, e); }
      });
      input.addEventListener("cancel", () => finish(resolve, null));
      // cancel イベントの無い古いブラウザ向け: ダイアログを閉じて画面に戻ったのに、選択も来ないとき
      env.addEventListener("focus", () => env.setTimeout(() => { if (!(input.files && input.files.length)) finish(resolve, null); }, 1500), { once: true });
      doc.body.appendChild(input);
      input.click();
    });
  }

  // ── 通知 ──
  const hasNotification = () => typeof env.Notification === "function";
  const notificationPermission = () => (hasNotification() ? env.Notification.permission : "unsupported");

  // 許可を求める(ユーザーの操作の直後に呼ぶこと)。すでに決まっていれば、その結果を返す。
  async function requestNotificationPermission() {
    if (!hasNotification()) return "unsupported";
    if (env.Notification.permission !== "default") return env.Notification.permission;
    try { return await env.Notification.requestPermission(); } catch { return env.Notification.permission; }
  }

  async function notify(title, message) {
    if (!hasNotification()) return { ok: false, reason: "unsupported" };
    if (env.Notification.permission !== "granted") return { ok: false, reason: env.Notification.permission };
    const opts = { body: message, tag: "study-tracker-phase" };
    try {
      const n = new env.Notification(title, opts);
      n.onclick = () => { try { env.focus && env.focus(); n.close(); } catch { /* 無視 */ } };
      return { ok: true };
    } catch {
      // Android など、コンストラクタを使えない環境は、Service Worker 経由
      try {
        const reg = nav && nav.serviceWorker && (await nav.serviceWorker.getRegistration());
        if (!reg) return { ok: false, reason: "no-service-worker" };
        await reg.showNotification(title, opts);
        return { ok: true };
      } catch (e) { return { ok: false, reason: String(e) }; }
    }
  }

  // ── 画面の消灯防止(Screen Wake Lock) ──
  // 画面が見えなくなると自動的に解除されるので、見える状態に戻ったとき、まだ必要なら取り直す。
  let wanted = false, sentinel = null;
  const wakeSupported = () => !!(nav && nav.wakeLock && nav.wakeLock.request);
  async function acquire() {
    if (!wanted || sentinel || !wakeSupported() || (doc && doc.visibilityState && doc.visibilityState !== "visible")) return;
    try {
      const s = await nav.wakeLock.request("screen");
      if (!wanted) { try { await s.release(); } catch { /* 無視 */ } return; }
      sentinel = s;
      if (s.addEventListener) s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
    } catch { /* 省電力モードなどで拒否されたとき。次に見えたときにまた試す */ }
  }
  if (doc && doc.addEventListener) doc.addEventListener("visibilitychange", () => { if (doc.visibilityState === "visible") acquire(); });

  async function setWakeLock(on) {
    wanted = !!on;
    if (wanted) {
      if (!wakeSupported()) return { ok: false, active: false, error: "unsupported" };
      await acquire();
      return { ok: !!sentinel, active: !!sentinel };
    }
    const s = sentinel;
    sentinel = null;
    if (s) { try { await s.release(); } catch { /* 無視 */ } }
    return { ok: true, active: false };
  }

  async function storageEstimate() {
    try { const e = await nav.storage.estimate(); return { usage: e.usage ?? 0, quota: e.quota ?? 0 }; } catch { return null; }
  }

  return {
    download, saveFile, pickFile, savePickerSupported: () => typeof env.showSaveFilePicker === "function", notificationPermission, requestNotificationPermission, notify, setWakeLock, storageEstimate,
    reload() { env.location.reload(); },
  };
}
