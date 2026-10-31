import test from "node:test";
import assert from "node:assert/strict";
import { pyRound, floorDiv, floorMod, intTrunc } from "../ui/js/core/num.js";

test("pyRound: Python と同じ偶数丸め(Math.round とは違う)", () => {
  assert.equal(pyRound(0.5), 0);
  assert.equal(pyRound(1.5), 2);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(62.5), 62);
  assert.equal(pyRound(63.5), 64);
  assert.equal(Math.round(62.5), 63);            // JS 標準だと違う、という確認
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.675, 2), 2.67);         // 2進数では 2.67499… なので 2.67
  assert.equal(pyRound(1.005, 2), 1);
});

test("pyRound: -0 を返さない", () => {
  assert.ok(Object.is(pyRound(-0.4), 0));
  assert.ok(Object.is(pyRound(-0.001, 2), 0));
});

test("// % int() は Python と同じ向き", () => {
  assert.equal(floorDiv(-7, 2), -4);
  assert.equal(floorMod(-7, 3), 2);
  assert.equal(floorMod(7, -3), -2);
  assert.equal(intTrunc(-2.7), -2);
});
