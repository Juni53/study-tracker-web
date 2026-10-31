import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { showUpdateBanner } = await import("../ui/js/components/updateBanner.js");
const { mountBackupBanner } = await import("../ui/js/components/backupBanner.js");
const tick = () => new Promise((r) => setTimeout(r, 0));

test("更新のお知らせ: 出る。重ねて呼んでも、1つだけ", () => {
  const el = showUpdateBanner(() => {});
  assert.ok(el && document.querySelector(".update-banner"));
  assert.match(el.querySelector(".nt-text").textContent, /新しいバージョンがあります/);
  assert.equal(showUpdateBanner(() => {}), null);
  assert.equal(document.querySelectorAll(".update-banner").length, 1);
  el.remove();
});

test("「更新する」で更新処理を呼ぶ(押した直後は、ボタンを無効にして『更新しています…』)", async () => {
  let called = 0, release;
  const el = showUpdateBanner(() => new Promise((r) => { called++; release = r; }));
  const btn = el.querySelector('[data-nt="apply"]');
  btn.click();
  await tick();
  assert.equal(called, 1);
  assert.equal(btn.disabled, true);
  assert.equal(el.querySelector(".nt-text").textContent, "更新しています…");
  release();
  el.remove();
});

test("「あとで」で閉じる(この画面の間だけ)", () => {
  const el = showUpdateBanner(() => {});
  el.querySelector('[data-nt="later"]').click();
  assert.equal(document.querySelector(".update-banner"), null);
});

test("お知らせは、1つの入れ物(固定表示)の中に縦に積まれて、重ならない", () => {
  const upd = showUpdateBanner(() => {});
  const bk = mountBackupBanner({ save_backup: async () => ({ ok: true }), snooze_backup_reminder: async () => ({ ok: true }) }, { days_since: 9 });
  const hosts = document.querySelectorAll(".notice-host");
  assert.equal(hosts.length, 1);
  assert.deepEqual([...hosts[0].children].map((c) => c.className.split(" ")[0]), ["update-banner", "backup-banner"]);
  upd.remove(); bk.remove();
});
