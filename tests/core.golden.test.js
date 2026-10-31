// Python 版を「正解」にした照合テスト。正解データは tools/golden/gen_pure.py で作る。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pyRound } from "../ui/js/core/num.js";
import { parseDuration, fmtTime } from "../ui/js/core/duration.js";
import { evalFormula, calcBasePoints, calcManualPoints } from "../ui/js/core/formula.js";
import { Api } from "../ui/js/core/localApi.js";
import { openStorage } from "../ui/js/core/storage.js";
import { parseCsv, csvRow, decodeCsvBytes } from "../ui/js/core/csv.js";

const golden = JSON.parse(readFileSync(new URL("./golden/pure.json", import.meta.url), "utf8"));
const store = await openStorage({ indexedDB: null });
const api = new Api(store);

// ★ Python 版との意図的な違い(どちらもコメントの理由で、JS 版を安全側にしている)
//   ・他の文字種の数字(アラビア数字など): Python は受け付けるが、JS 版は受け付けない(全角 0-9 は受け付ける)
//   ・結果が無限大になる換算式: Python 版は inf を返してしまうが、JS 版は fallback にする
const KNOWN = { "parse_duration|٣": { throws: true } };

const calls = {
  round: (x, nd) => pyRound(x, nd),
  parse_duration: (t) => parseDuration(t),
  fmt_time: (n) => fmtTime(n),
  csv_parse: (t) => parseCsv(t),
  csv_row: (row) => csvRow(row),
  csv_read_rows: (b64) => parseCsv(decodeCsvBytes(Buffer.from(b64, "base64"))),
  eval_formula: (f, v) => evalFormula(f, v, -1.0),
  calc_base_points: (m, f) => calcBasePoints(m, f),
  calc_manual_points: (m, f, g) => calcManualPoints(m, f, g),
  "api.preview_points": (t, s) => api.preview_points(t, s),
  "api.calc_formula_preview": (f, m) => api.calc_formula_preview(f, m),
  "api.get_points_balance": () => api.get_points_balance(),
  "api.get_settings": () => api.get_settings(),
};

let inexact = 0, numeric = 0;
// 数値は、浮動小数点の最後の桁(libm の違い)だけは許す。それ以外は完全一致。
function same(a, b, path) {
  if (typeof b === "number" && typeof a === "number") {
    numeric++;
    if (a !== b) inexact++;
    const tol = 1e-12 * Math.max(1, Math.abs(b));
    assert.ok(Math.abs(a - b) <= tol, `${path}: ${a} !== ${b}`);
    return;
  }
  if (Array.isArray(b)) {
    assert.ok(Array.isArray(a) && a.length === b.length, `${path}: 配列の長さ`);
    b.forEach((x, i) => same(a[i], x, `${path}[${i}]`));
    return;
  }
  if (b && typeof b === "object") {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: キー`);
    for (const k of Object.keys(b)) same(a[k], b[k], `${path}.${k}`);
    return;
  }
  assert.strictEqual(a, b, path);
}

const byFn = Object.groupBy(golden.cases, (c) => c.fn);

for (const [fn, cases] of Object.entries(byFn)) {
  test(`照合: ${fn} (${cases.length} 件)`, (t) => {
    assert.ok(calls[fn], `${fn} の呼び出しが未定義`);
    for (const c of cases) {
      const label = `${fn}(${c.args.map((a) => JSON.stringify(a)).join(", ")})`;
      const known = KNOWN[`${fn}|${c.args[0]}`];
      let expectThrows = known ? known.throws : c.throws;
      if (fn === "eval_formula" && c.throws) {        // inf になる式 → JS 版は fallback(-1)
        assert.equal(calls[fn](...c.args), -1.0, label);
        continue;
      }
      if (expectThrows) {
        assert.throws(() => calls[fn](...c.args), undefined, label);
      } else {
        same(calls[fn](...c.args), c.expect, label);
      }
    }
    t.diagnostic(`数値 ${numeric} 個のうち、完全には一致しなかった(最後の桁の差)もの: ${inexact}`);
  });
}

test("既定の換算式を 1 分刻みで 0〜1440 分まで: floor の境目でも完全一致", () => {
  for (const { formula, values } of golden.sweep) {
    values.forEach((expected, m) => {
      assert.strictEqual(calcBasePoints(m, formula), expected, `${formula} @ ${m}分`);
    });
  }
});
