// さぼりペナルティ(ポイントの消失)の金額は、四捨五入した整数(Web 版の意図した変更。Python 版は小数第 2 位まで)。
// Python 版との照合(core.scenarios.test.js)は、tools/golden/web_divergences.py の変更を当てた Python 版を正解にしている。ここでは、振る舞いそのものと、記載の3か所を確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { roundHalfUp, pyRound } from "../ui/js/core/num.js";

const at = (m, d) => () => new Date(2026, m - 1, d, 10, 0, 0);
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// 勉強は 10/20 が最後。残高を balance に決めて、clock を進めながら試す(猶予 7 日 → 10/28 から 1 日ぶんずつ)
async function world(balance, { rate } = {}) {
  let restore = setClock(at(10, 20));
  const store = await openStorage({ indexedDB: new IDBFactory() });
  const api = new Api(store);
  api.add_record("2026-10-20", "1h", "x", [], [], "manual", 3, null);
  api.dm.points.balance = balance;
  api.dm.points.history = [];
  if (rate !== undefined) api.update_setting("decay_rate", rate);
  const go = (m, d) => { restore(); restore = setClock(at(m, d)); api.run_day_rollover(); };
  go(10, 27);   // 猶予(7 日)の最終日まで進めておく(消失の最終適用日 = 10/27)。このあと、1 日進むごとに 1 日ぶんのペナルティ
  const penalties = () => api.dm.points.history.filter((h) => /サボりペナルティ/.test(h.reason));
  return { api, go, penalties, end: () => restore() };
}

test("roundHalfUp: 四捨五入(ちょうど半分は切り上げ)。偶数丸め(pyRound)とは違う", () => {
  const cases = [[0, 0], [0.49, 0], [0.5, 1], [1.49, 1], [1.5, 2], [2.5, 3], [3.5, 4], [12.5, 13], [19.6, 20], [19.21, 19], [24.99, 25], [1e6 + 0.5, 1e6 + 1]];
  for (const [x, want] of cases) assert.equal(roundHalfUp(x), want, `roundHalfUp(${x})`);
  assert.equal(pyRound(2.5, 0), 2, "(前提)pyRound は偶数丸め");
  assert.equal(roundHalfUp(2.5), 3);
  // 計算の途中の誤差で、半分の判定が狂わない
  assert.equal(roundHalfUp(25.499999999999996), 26, "誤差で半分を割った値でも、半分として切り上げ");
  assert.equal(roundHalfUp(0.1 * 3 * 5), 2);                       // 1.5000000000000002
  assert.equal(roundHalfUp(0.7 * 5), 4);                           // 3.5 になるはずの値
  assert.equal(Object.is(roundHalfUp(0.2), 0), true, "-0 を返さない");
  assert.equal(Object.is(roundHalfUp(-0.2), 0), true);
  assert.equal(roundHalfUp(-2.5), -3);
  assert.ok(Number.isNaN(roundHalfUp(NaN)));
  assert.equal(roundHalfUp(Infinity), Infinity);
});

test("毎日の判定: 1 日ぶんの金額は整数で、残高 × 2% の四捨五入。毎日、その日の残高から求める", async () => {
  const w = await world(1000);
  assert.equal(w.api.get_points_balance(), 1000, "7 日の猶予の中: 何も引かれない");
  w.go(10, 28); w.go(10, 29); w.go(10, 30);
  const deltas = w.penalties().map((h) => h.delta);
  assert.deepEqual(deltas, [-20, -20, -19], "1000 → -20(980)、980 → -19.6 → -20(960)、960 → -19.2 → -19");
  assert.deepEqual(w.penalties().map((h) => h.balance), [980, 960, 941]);
  for (const h of w.penalties()) { assert.ok(Number.isInteger(h.delta)); assert.match(h.reason, /^⚠️ サボりペナルティ \(-2%\/日\)$/); }
  w.end();
});

test("ちょうど半分は切り上げ(625 の 2% = 12.5 → 13。偶数丸めなら 12 になるところ)", async () => {
  const w = await world(625);
  w.go(10, 28);
  assert.deepEqual(w.penalties().map((h) => h.delta), [-13]);
  assert.equal(w.api.get_points_balance(), 612);
  w.end();
});

test("金額が 0 に丸まる少ない残高は、減らない(2% なら 24 まで)。25 から 1 ポイントずつ", async () => {
  const small = await world(24);
  small.go(10, 28); small.go(10, 29);
  assert.equal(small.penalties().length, 0, "24 × 2% = 0.48 → 0: ペナルティの記録が付いた");
  assert.equal(small.api.get_points_balance(), 24);
  small.end();
  const edge = await world(25);
  edge.go(10, 28);
  assert.deepEqual(edge.penalties().map((h) => h.delta), [-1], "25 × 2% = 0.5 → 1");
  assert.equal(edge.api.get_points_balance(), 24);
  edge.end();
});

test("割合を変えても、金額は整数(5% なら 1000 → -50、950 → 47.5 → -48)", async () => {
  const w = await world(1000, { rate: 0.05 });
  w.go(10, 28); w.go(10, 29);
  assert.deepEqual(w.penalties().map((h) => h.delta), [-50, -48]);
  assert.match(w.penalties()[0].reason, /\(-5%\/日\)/);
  w.end();
});

test("もとの残高に小数があっても、ペナルティの金額は整数(残高の小数は、そのまま残る)", async () => {
  const w = await world(1394.8);
  w.go(10, 28);
  assert.deepEqual(w.penalties().map((h) => h.delta), [-28], "1394.8 × 2% = 27.896 → 28");
  assert.equal(w.api.get_points_balance(), 1366.8);
  w.end();
});

test("過去の日付の記録を足したときの空白期間のペナルティも、整数(その時点の残高から、1 日ずつ四捨五入)", async () => {
  const restore = setClock(at(10, 20));
  const store = await openStorage({ indexedDB: new IDBFactory() });
  const api = new Api(store);
  api.add_record("2026-09-01", "1h", "x", [], [], "manual", 3, null);
  api.dm.points.balance = 1000;
  api.dm.points.history = [];
  api.add_record("2026-09-20", "1h", "y", [], [], "manual", 3, null);      // 9/1 のあと 19 日空いた記録を、あとから足す(猶予 7 日 → 12 日ぶん)
  const pens = api.dm.points.history.filter((h) => /サボりペナルティ\(過去記録分\)/.test(h.reason));
  assert.equal(pens.length, 12, "空白 19 日 − 猶予 7 日 = 12 日ぶん");
  for (const h of pens) {
    const before = Number((h.balance - h.delta).toFixed(2));
    assert.ok(Number.isInteger(h.delta), `金額が整数でない: ${h.delta}`);
    assert.equal(h.delta, -roundHalfUp(before * 0.02), `${before} の 2% の四捨五入にならない`);
  }
  restore();
});

test("Python 版との意図した違いが、一覧(web_divergences.py)・説明(README_web.md)・コードの注釈の3か所に書いてある。小数第 2 位の丸めは残っていない", () => {
  const py = read("tools/golden/web_divergences.py");
  assert.match(py, /さぼりペナルティ: 金額は四捨五入した整数\(毎日の判定\)/);
  assert.match(py, /さぼりペナルティ: 金額は四捨五入した整数\(過去の日付の記録を足したとき\)/);
  assert.match(py, /int\(round\(self\.points\["balance"\] \* rate, 9\) \+ 0\.5\)/);
  const doc = read("README_web.md");
  assert.match(doc, /さぼりペナルティ\(ポイントの消失\)の金額/);
  assert.match(doc, /四捨五入した\*\*整数\*\*/);
  const dm = read("ui/js/core/dataManager.js");
  assert.match(dm, /★Python 版との違い\(意図した変更\): 1 日ぶんのペナルティの金額は/);
  const code = dm.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /pyRound\(this\.points\.balance \* rate/, "ペナルティの金額に、小数第 2 位の丸めが残っている");
  assert.equal((code.match(/roundHalfUp\(this\.points\.balance \* rate\)/g) || []).length, 2, "ペナルティを求める 2 か所とも、四捨五入の整数にする");
});
