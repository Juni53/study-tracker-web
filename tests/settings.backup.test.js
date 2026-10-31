// 設定ページの「完全バックアップ」まわりの操作(保存・周期・復元(統合)・元に戻す)を、jsdom で通して確かめる。
// 本物の API(core/localApi.js)+ 偽の platform。ダイアログも本物を使い、ボタンを押して進める。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { buildBackup } from "../ui/js/core/backup.js";
import { setupDom } from "./_dom.js";

const html = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8").replace(/<script[\s\S]*?<\/script>/g, "");
setupDom(html);
const w = window;
for (const k of ["addEventListener", "removeEventListener", "requestAnimationFrame", "cancelAnimationFrame"]) globalThis[k] = w[k].bind(w);
if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = w.matchMedia.bind(w);
globalThis.innerWidth = 1100; globalThis.innerHeight = 800;
globalThis.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };

const until = async (cond, what, ms = 1500) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = cond(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail(`待っても起きませんでした: ${what}`);
};
const openDlg = () => [...document.querySelectorAll(".modal-overlay.dlg.open")].pop();
const click = (el) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

test("設定ページ: バックアップの保存・周期・復元(記録だけ統合)・元に戻す", async () => {
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const calls = { saved: [], reloads: 0 };
    const platform = {
      picked: null,
      async saveFile(filename, text) { calls.saved.push({ filename, text }); return { ok: true, filename: "保存した.json", method: "picker" }; },
      savePickerSupported: () => true,
      async pickFile() { return this.picked; },
      reload() { calls.reloads++; },
      async storageEstimate() { return null; },
    };
    const real = new Api(store, { platform });
    real.add_record("2026-10-26", "1h", "いまの記録", [], [], "manual");
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });

    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, api);

    // 状態の表示と、周期の選択
    const status = () => root.querySelector("#backupStatus").textContent;
    await until(() => status(), "状態の表示");
    assert.match(status(), /まだバックアップを取っていません。保存先を選べます/);
    const active = () => root.querySelector("#backupInterval .tbtn.active")?.dataset.days;
    assert.equal(active(), "7");
    click(root.querySelector('#backupInterval [data-days="14"]'));
    await until(() => active() === "14", "周期が2週間になる");
    assert.equal(real.get_backup_status().interval_days, 14);

    // 保存 → 完了のダイアログ → 状態が更新される
    click(root.querySelector("#backupSaveBtn"));
    await until(() => openDlg(), "保存の完了ダイアログ");
    assert.match(openDlg().querySelector(".dlg-message").textContent, /バックアップを保存しました。\n保存した\.json（?\(?記録 1件/);
    click(openDlg().querySelector('[data-dlg="ok"]'));
    await until(() => /最後のバックアップ: 2026-10-27（?\(?今日/.test(status()), "状態が更新される");
    assert.equal(calls.saved.length, 1);

    const balanceBefore = real.get_points_balance();

    // 復元: ファイルを選ぶ → 3択の確認 → 「記録だけ統合」 → 結果 → 再読み込み
    platform.picked = { name: "他の端末.json", bytes: new TextEncoder().encode(JSON.stringify(buildBackup({
      "records.json": [{ id: 1, date: "2026-10-20", minutes: 30, content: "別の端末の記録", tag_ids: [], exam_ids: [], source: "manual", quality: 3, points_earned: 5 }],
      "points.json": { balance: 123.5, history: [] },
    }, "2026-10-25T09:00:00"))) };
    click(root.querySelector("#backupRestoreBtn"));
    await until(() => openDlg() && openDlg().querySelector('[data-dlg="alt"]'), "復元の選択ダイアログ");
    const msg = openDlg().querySelector(".dlg-message").textContent;
    assert.match(msg, /ファイル: 他の端末\.json/);
    assert.match(msg, /このファイルの内容: 記録 1件（?\(?2026-10-20 〜 2026-10-20/);
    assert.match(msg, /いまのデータ: 記録 1件/);
    assert.match(msg, /ポイント 123\.5/);
    const labels = [...openDlg().querySelectorAll("button")].map((b) => b.textContent);
    assert.deepEqual(labels, ["キャンセル", "記録だけ統合", "上書きして復元"]);
    click(openDlg().querySelector('[data-dlg="alt"]'));
    await until(() => openDlg() && /1件の記録を統合しました/.test(openDlg().querySelector(".dlg-message").textContent), "統合の結果");
    assert.match(openDlg().querySelector(".dlg-message").textContent, /アプリを再読み込みします/);
    click(openDlg().querySelector('[data-dlg="ok"]'));
    await until(() => calls.reloads === 1, "再読み込み");
    assert.equal(real.get_records().length, 2);
    assert.equal(real.get_points_balance(), balanceBefore);                 // 統合では、ポイントは動かない(バックアップの 123.5 にならない)

    // 元に戻す(画面を描き直して、控えの表示から)
    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    await (await import("../ui/js/views/settings.js")).render(root2, api);
    await until(() => !root2.querySelector("#undoRow").hidden, "元に戻すの表示");
    assert.match(root2.querySelector("#undoText").textContent, /記録の統合の直前の状態に戻せます/);
    click(root2.querySelector("#undoBtn"));
    await until(() => openDlg() && openDlg().querySelector('[data-dlg="ok"]'), "元に戻すの確認");
    click(openDlg().querySelector('[data-dlg="ok"]'));
    await until(() => openDlg() && /元に戻しました（?\(?記録 1件/.test(openDlg().querySelector(".dlg-message").textContent), "元に戻した結果");
    click(openDlg().querySelector('[data-dlg="ok"]'));
    await until(() => calls.reloads === 2, "再読み込み(2回目)");
    assert.equal(real.get_records().length, 1);
    assert.equal(real.get_records()[0].content, "いまの記録");
  } finally { restore(); }
});

test("設定ページ: 不正なバックアップは、理由を表示して、何も変更しない", async () => {
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const platform = { picked: null, async saveFile() { return { ok: true }; }, savePickerSupported: () => false, async pickFile() { return this.picked; }, reload() { throw new Error("呼ばれないはず"); }, async storageEstimate() { return null; } };
    const real = new Api(store, { platform });
    real.add_record("2026-10-26", "1h", "いまの記録", [], [], "manual");
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });
    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, api);
    await until(() => root.querySelector("#backupStatus").textContent, "状態の表示");
    assert.match(root.querySelector("#backupStatus").textContent, /ブラウザのダウンロード先に保存されます/);

    platform.picked = { name: "壊れた.json", bytes: new TextEncoder().encode(JSON.stringify({ format: "study-tracker-backup", schemaVersion: 1, files: { "records.json": [{ id: 1, date: "2026-02-30", minutes: 5 }] } })) };
    const dialogs = document.querySelectorAll(".modal-overlay.dlg").length;
    click(root.querySelector("#backupRestoreBtn"));
    await until(() => document.querySelectorAll(".modal-overlay.dlg").length > dialogs && openDlg(), "エラーのダイアログ");
    const msg = openDlg().querySelector(".dlg-message").textContent;
    assert.match(msg, /読み込めませんでした/);
    assert.match(msg, /日付が正しくありません/);
    click(openDlg().querySelector('[data-dlg="ok"]'));
    assert.equal(real.get_records().length, 1);
    assert.equal(real.get_backup_status().undo, null);
  } finally { restore(); }
});

test("設定ページ: テーマの列とバックアップ周期の列は、互いの選択・設定に影響しない(回帰: 以前は、片方を選ぶともう片方が外れ、テーマが壊れた)", async () => {
  const restore = setClock(() => new Date(2026, 9, 27, 10, 0, 0));
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const platform = { async saveFile() { return { ok: true }; }, savePickerSupported: () => true, async pickFile() { return null; }, reload() {}, async storageEstimate() { return null; } };
    const real = new Api(store, { platform });
    real.add_record("2026-10-26", "1h", "x", [], [], "manual");
    const updates = [];
    const origUpdate = real.update_setting.bind(real);
    real.update_setting = (k, v) => { updates.push([k, v]); return origUpdate(k, v); };
    const api = new Proxy({}, { get: (_, m) => async (...a) => structuredClone(await real[m](...structuredClone(a))) });

    const root = document.createElement("div");
    document.body.appendChild(root);
    await (await import("../ui/js/views/settings.js")).render(root, api);
    await until(() => root.querySelector("#backupStatus").textContent, "状態の表示");

    const act = (sel) => [...root.querySelectorAll(`${sel} .tbtn.active`)].map((b) => b.dataset.theme ?? b.dataset.days);
    const theme = () => act("#themeRow"), interval = () => act("#backupInterval");
    assert.deepEqual(theme(), ["system"]);
    assert.deepEqual(interval(), ["7"]);

    // 周期を選ぶ → テーマの選択も、保存されたテーマも、そのまま
    click(root.querySelector('#backupInterval [data-days="14"]'));
    await until(() => real.get_backup_status().interval_days === 14, "周期が保存される");
    assert.deepEqual(interval(), ["14"]);
    assert.deepEqual(theme(), ["system"]);
    assert.equal(real.get_settings().theme, "system");
    assert.deepEqual(updates, []);                                              // テーマの保存処理は、呼ばれていない

    // テーマを選ぶ → 周期の選択も、保存された周期も、そのまま
    click(root.querySelector('#themeRow [data-theme="dark"]'));
    await until(() => real.get_settings().theme === "dark", "テーマが保存される");
    assert.deepEqual(theme(), ["dark"]);
    assert.deepEqual(interval(), ["14"]);
    assert.equal(real.get_backup_status().interval_days, 14);
    assert.deepEqual(updates, [["theme", "dark"]]);

    // もう一度ずつ(逆の順番)
    click(root.querySelector('#backupInterval [data-days="0"]'));
    await until(() => real.get_backup_status().interval_days === 0, "周期が保存される(通知しない)");
    click(root.querySelector('#themeRow [data-theme="light"]'));
    await until(() => real.get_settings().theme === "light", "テーマが保存される(ライト)");
    assert.deepEqual(theme(), ["light"]);
    assert.deepEqual(interval(), ["0"]);
    assert.ok(updates.every(([, v]) => v !== undefined), "値の無い設定が保存されようとした");

    // 画面を描き直しても、それぞれの選択が復元される
    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    await (await import("../ui/js/views/settings.js")).render(root2, api);
    await until(() => root2.querySelector("#backupInterval .tbtn.active"), "描き直し後の周期");
    assert.deepEqual([...root2.querySelectorAll("#themeRow .tbtn.active")].map((b) => b.dataset.theme), ["light"]);
    assert.deepEqual([...root2.querySelectorAll("#backupInterval .tbtn.active")].map((b) => b.dataset.days), ["0"]);
  } finally { restore(); }
});
