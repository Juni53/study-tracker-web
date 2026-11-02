// さぼり券(Web 版の意図した変更): アプリを開いただけの日も、勉強の記録がなければ、対象にする。
// (Python 版は、起動ログにある日で、遡るのをやめていた。tools/golden/web_divergences.py に、この違いを書いてある)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { F } from "../ui/js/core/defaults.js";

const at = (m, d, h = 10) => () => new Date(2026, m - 1, d, h, 0, 0);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const jl = (api, f) => api.dm._jload(f, () => []);

// 10/19・10/20 に勉強。さぼり券 owned 枚。clock を進めながら、使う
async function world({ owned = 3, studyDays = ["2026-10-19", "2026-10-20"] } = {}) {
  let restore = setClock(at(10, 20));
  const store = await openStorage({ indexedDB: new IDBFactory() });
  const api = new Api(store);
  for (const d of studyDays) api.add_record(d, "1h", "x", [], [], "manual", 3, null);
  api.dm.store.save(F.saboriOwned, { owned });
  const go = (m, d) => { restore(); restore = setClock(at(m, d)); };
  return { api, go, end: () => restore() };
}

test("アプリを開いただけの日(起動ログのある日)にも、さぼり券が使われる。新しい日から順に、券がある分だけ", async () => {
  const w = await world({ owned: 3 });
  w.go(10, 21); w.api.dm.runStartupTasks();                       // 10/21 に、勉強せずにアプリを開いた
  w.go(10, 22);
  assert.deepEqual(w.api.dm.runStartupTasks(), { sabori: ["2026-10-21"] }, "起動した日(10/21)に、券が使われない");
  w.go(10, 24);
  const r = w.api.run_day_rollover();                              // 10/22 も、アプリは開いた日(起動ログにある)
  assert.deepEqual(r.sabori_applied, ["2026-10-23", "2026-10-22"]);
  assert.deepEqual(jl(w.api, F.sabori), ["2026-10-21", "2026-10-22", "2026-10-23"]);
  assert.equal(w.api.get_shop().sabori.owned, 0);
  assert.equal(w.api.get_home_data().streak, 5, "連続記録が、10/19〜10/23 の5日にならない");
  w.end();
});

test("起動ログは、今までどおり記録する(バックアップ・取り込みなど、データの互換のため)", async () => {
  const w = await world({ owned: 0 });
  w.go(10, 22); w.api.dm.runStartupTasks();
  assert.ok(jl(w.api, F.launchLog).includes("2026-10-22"));
  w.end();
});

test("記録のある日に達したら、そこで遡るのをやめる(それより前には使わない)", async () => {
  const w = await world({ owned: 3, studyDays: ["2026-10-19", "2026-10-22"] });
  w.go(10, 24);
  assert.deepEqual(w.api.run_day_rollover().sabori_applied, ["2026-10-23"]);   // 10/23 だけ。10/22 は記録がある
  assert.equal(w.api.get_shop().sabori.owned, 2);
  w.end();
});

test("今日は対象にならない(今日が終わってから)/ 券が無ければ何も使わない", async () => {
  const w = await world({ owned: 2 });
  w.go(10, 21);
  assert.deepEqual(w.api.run_day_rollover().sabori_applied, [], "今日(10/21)に使った");
  const none = await world({ owned: 0 });
  none.go(10, 25);
  assert.deepEqual(none.api.run_day_rollover().sabori_applied, []);
  w.end(); none.end();
});

test("run_day_rollover: 同じ日に何度呼んでも、二重には使わない(券・ポイント・ログが変わらない)", async () => {
  const w = await world({ owned: 2 });
  w.go(10, 24);
  const first = w.api.run_day_rollover();
  const snap = () => JSON.stringify([w.api.get_points_balance(), w.api.get_shop().sabori.owned, jl(w.api, F.sabori), w.api.dm.points.history.length]);
  const a = snap();
  const again = [w.api.run_day_rollover(), w.api.run_day_rollover()];
  assert.equal(snap(), a, "2回目以降で、状態が変わった");
  assert.deepEqual(again.map((r) => r.sabori_applied), [[], []]);
  assert.deepEqual(first.sabori_applied, ["2026-10-23", "2026-10-22"]);
  w.end();
});

test("run_day_rollover: ポイントの消失も、日付が変わるたびにかかる(猶予を過ぎた日から、1日ぶんずつ)", async () => {
  const w = await world({ owned: 0 });
  const bal0 = w.api.get_points_balance();
  w.go(10, 27); w.api.run_day_rollover();                           // 勉強は10/20 が最後。7日の猶予の中
  assert.equal(w.api.get_points_balance(), bal0);
  w.go(10, 28); w.api.run_day_rollover();                           // 8日目: 1日ぶん(2%)
  const b1 = w.api.get_points_balance();
  assert.ok(b1 < bal0);
  w.go(10, 29); w.api.run_day_rollover();
  assert.ok(w.api.get_points_balance() < b1, "翌日の消失がかからない");
  w.end();
});

test("API の登録: run_day_rollover は、Web 専用 API の一覧にある", () => {
  assert.match(read("ui/js/core/localApi.js"), /"run_day_rollover"/);
});

test("Python 版との意図した違いが、一覧(web_divergences.py)・説明(README_web.md)・コードの注釈の3か所に書いてある", () => {
  const py = read("tools/golden/web_divergences.py");
  assert.match(py, /さぼり券: 起動しただけの日も対象にする/);
  assert.match(py, /if iso in launch_log/);
  const doc = read("README_web.md");
  assert.match(doc, /## Python 版との意図した違い/);
  assert.match(doc, /さぼり券/);
  assert.match(doc, /web_divergences\.py/);
  assert.match(read("ui/js/core/dataManager.js"), /★Python 版との違い\(意図した変更\)/);
  assert.doesNotMatch(read("ui/js/core/dataManager.js").split("autoApplySabori() {")[1].split("// 今日の起動を記録")[0], /launchLog\.has/, "起動ログで、遡るのをやめる処理が残っている");
});

test("画面の説明(ショップ・はじめに)も、新しい仕様(アプリを開いただけの日も対象)になっている", () => {
  const shop = read("ui/js/views/shop.js");
  assert.match(shop, /勉強の記録がなかった日\(アプリを開いただけの日も\)に自動で使われ/);
  assert.doesNotMatch(shop, /アプリの起動もなかった/);
  const onb = read("ui/js/components/onboarding.js");
  assert.match(onb, /勉強の記録がなかった日\(アプリを開いただけの日も\)に自動で使われて/);
  assert.doesNotMatch(onb, /アプリの起動もしなかった/);
});
