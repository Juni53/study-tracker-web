// テスト用: 値の比較。数値は、浮動小数点の最後の桁(libm の違い)だけ許す。それ以外は完全一致。
import assert from "node:assert/strict";

export function makeSame(tolRel = 1e-12) {
  const stats = { numeric: 0, inexact: 0 };
  function same(a, b, path = "$") {
    if (typeof b === "number" && typeof a === "number") {
      stats.numeric++;
      if (a !== b) stats.inexact++;
      assert.ok(Math.abs(a - b) <= tolRel * Math.max(1, Math.abs(b)), `${path}: ${a} !== ${b}`);
      return;
    }
    if (Array.isArray(b)) {
      assert.ok(Array.isArray(a), `${path}: 配列のはずが ${JSON.stringify(a)}`);
      assert.equal(a.length, b.length, `${path}: 配列の長さ ${a.length} !== ${b.length}`);
      b.forEach((x, i) => same(a[i], x, `${path}[${i}]`));
      return;
    }
    if (b && typeof b === "object") {
      assert.ok(a && typeof a === "object" && !Array.isArray(a), `${path}: オブジェクトのはずが ${JSON.stringify(a)}`);
      assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: キー`);
      for (const k of Object.keys(b)) same(a[k], b[k], `${path}.${k}`);
      return;
    }
    assert.strictEqual(a, b, path);
  }
  return { same, stats };
}
