// 状態を持つ処理の照合: Python 版で台本どおりに動かした結果(戻り値と保存データ)と、JS 版を比べる。
// 正解データは tools/golden/gen_scenarios.py で作る。台本の "init" はアプリの起動(保存データを読み直し、起動時の処理を実行)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock } from "../ui/js/core/dates.js";
import { makeSame } from "./_same.js";

const scenarios = JSON.parse(gunzipSync(readFileSync(new URL("./golden/scenarios.json.gz", import.meta.url))).toString("utf8"));

const parseNow = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
const jsonNorm = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

function normSnapshot(files) {
  const out = jsonNorm(files);
  if (out["milestones_achieved.json"]) out["milestones_achieved.json"].sort();   // 保存順は不定(Python では set 由来)
  return out;
}

for (const sc of scenarios) {
  test(`台本: ${sc.name} (${sc.steps.length} ステップ)`, async (t) => {
    const { same, stats } = makeSame();
    const idb = new IDBFactory();
    let store = await openStorage({ indexedDB: idb });
    for (const [name, value] of Object.entries(sc.initial)) store.save(name, value);
    await store.flush();
    store.close();
    store = null;
    let api = null;
    const restore = setClock(() => new Date(2026, 0, 1));
    try {
      for (const [i, step] of sc.steps.entries()) {
        const where = `[${sc.name}] ステップ ${i} ${step.init ? "init" : step.call}(${JSON.stringify(step.args ?? []).slice(0, 200)}) @${step.now}`;
        try {
          setClock(() => parseNow(step.now));
          if (step.init) {
            if (store) { await store.flush(); store.close(); }
            store = await openStorage({ indexedDB: idb });
            api = new Api(store);
          } else if (step.call === "export_csv") {
            assert.equal(api.dm.exportCsvText(), step.csv, "CSV の中身");
          } else if (step.call === "import_csv_bytes") {
            const result = jsonNorm(api.dm.importCsv(Buffer.from(step.b64, "base64")));
            if (step.throws_in_python) assert.equal(result.ok, false, "Python 版は例外で止まる入力: JS 版はエラーの結果として返す");
            else same(result, step.result, "result");
          } else {
            let threw = false, result;
            try { result = jsonNorm(api[step.call](...structuredClone(step.args))); } catch (e) { threw = true; if (!step.throws) throw e; }
            assert.equal(threw, !!step.throws, "例外の有無");
            if (!step.throws) same(result, step.result, "result");
          }
          if (step.snapshot) {
            const actual = normSnapshot(store.exportAll());
            assert.deepEqual(Object.keys(actual).sort(), Object.keys(step.snapshot).sort(), "保存されているファイルの一覧");
            same(actual, step.snapshot, "snapshot");
          }
        } catch (e) {
          e.message = `${where}\n${e.message}`;
          throw e;
        }
      }
    } finally { restore(); if (store) store.close(); }
    t.diagnostic(`数値 ${stats.numeric} 個、最後の桁の差 ${stats.inexact} 個`);
  });
}
