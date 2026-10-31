import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { showBackupBannerIfDue } = await import("../ui/js/components/backupBanner.js");
const tick = () => new Promise((r) => setTimeout(r, 0));
const banner = () => document.querySelector(".backup-banner");

function fakeApi({ due = true, days = 9, saveResult = { ok: true, filename: "b.json" } } = {}) {
  const calls = [];
  return {
    calls,
    async get_backup_status() { calls.push("status"); return { due, days_since: days }; },
    async save_backup() { calls.push("save"); return saveResult; },
    async snooze_backup_reminder() { calls.push("snooze"); return { ok: true }; },
  };
}

test("周期がたっていなければ、出さない", async () => {
  const api = fakeApi({ due: false });
  assert.equal(await showBackupBannerIfDue(api), null);
  assert.equal(banner(), null);
});

test("状態を取れなくても、例外にならず、出さない", async () => {
  assert.equal(await showBackupBannerIfDue({ get_backup_status: async () => { throw new Error("x"); } }), null);
});

test("周期がたっていれば、日数つきで出る。「あとで」で延期して閉じる", async () => {
  const api = fakeApi();
  const el = await showBackupBannerIfDue(api);
  assert.ok(el && banner());
  assert.match(el.querySelector(".bb-text").textContent, /最後のバックアップから 9 日たちました/);
  el.querySelector('[data-bb="later"]').click();
  await tick(); await tick();
  assert.deepEqual(api.calls, ["status", "snooze"]);
  assert.equal(banner(), null);
});

test("まだバックアップが無いときの文言 / 「バックアップを取る」で保存し、成功したら完了の表示になる", async () => {
  const api = fakeApi({ days: null });
  const el = await showBackupBannerIfDue(api);
  assert.match(el.querySelector(".bb-text").textContent, /まだバックアップを取っていません/);
  el.querySelector('[data-bb="now"]').click();
  await tick(); await tick();
  assert.deepEqual(api.calls, ["status", "save"]);
  assert.equal(el.querySelector(".bb-text").textContent, "バックアップを保存しました");
  assert.equal(el.querySelector(".bb-sub").textContent, "b.json");
  assert.equal(el.querySelector(".bb-actions"), null);
  el.remove();
});

test("保存先を選ばずに閉じたら、そのまま残る(もう一度押せる)。失敗したら、理由を出して、もう一度押せる", async () => {
  const a = fakeApi({ saveResult: { ok: true, cancelled: true } });
  const el = await showBackupBannerIfDue(a);
  el.querySelector('[data-bb="now"]').click();
  await tick(); await tick();
  assert.equal(el.querySelector('[data-bb="now"]').disabled, false);
  assert.ok(banner());
  el.remove();

  const b = fakeApi({ saveResult: { ok: false, error: "disk full" } });
  const el2 = await showBackupBannerIfDue(b);
  el2.querySelector('[data-bb="now"]').click();
  await tick(); await tick();
  assert.match(el2.querySelector(".bb-sub").textContent, /保存できませんでした.*disk full/);
  assert.equal(el2.querySelector('[data-bb="now"]').disabled, false);
  el2.remove();
});
