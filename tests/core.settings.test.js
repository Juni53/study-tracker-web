// 設定値の保護: 値の無い(undefined)設定は保存しない・すでに壊れて保存された設定は、読み込み時に取り除く。
import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { F } from "../ui/js/core/defaults.js";

const clock = () => setClock(() => new Date(2026, 9, 27, 10, 0, 0));

test("update_setting: 値が undefined の設定は、拒否して、何も変更・保存しない", async () => {
  const restore = clock();
  try {
    const store = await openStorage({ indexedDB: new IDBFactory() });
    const api = new Api(store);
    api.update_setting("theme", "dark");
    assert.deepEqual(api.update_setting("theme", undefined), { ok: false, error: "設定の値が指定されていません" });
    assert.equal(api.get_settings().theme, "dark");
    assert.ok(!("theme" in store.get(F.settings) && store.get(F.settings).theme === undefined));
    // null や false・0・空文字は、正当な値として保存できる
    for (const v of [null, false, 0, ""]) assert.deepEqual(api.update_setting("decay_days", v), { ok: true });
    assert.equal(api.get_settings().decay_days, "");
  } finally { restore(); }
});

test("読み込み: theme が undefined で保存されていても、既定値に戻る(以前のバグで壊れたデータの自動修復)。他の設定は残る", async () => {
  const restore = clock();
  try {
    const idb = new IDBFactory();
    const store = await openStorage({ indexedDB: idb });
    store.save(F.settings, { theme: undefined, decay_days: 3, pomodoro: { work: 40 } });
    await store.flush();
    store.close();

    const again = await openStorage({ indexedDB: idb });          // IndexedDB から読み直す(実際に壊れたデータが保存されている状況)
    assert.ok("theme" in again.get(F.settings));                   // 壊れた値が、実際に保存されている
    const api = new Api(again);
    const s = api.get_settings();
    assert.equal(s.theme, "system");
    assert.equal(s.decay_days, 3);
    assert.equal(s.pomodoro.work, 40);
    assert.equal(s.pomodoro.short_break, 5);
    // 次に設定を保存すると、壊れた値も取り除かれた状態で保存される
    api.update_setting("decay_rate", 0.05);
    assert.ok(!("theme" in again.get(F.settings)) || again.get(F.settings).theme === "system");
  } finally { restore(); }
});
