import test from "node:test";
import assert from "node:assert/strict";
import { CHIMES, ATTACK_SEC, SILENCE, chimeKindFor, volumeToPeak, scheduleChime } from "../ui/js/components/chime.js";

// AudioContext の偽物: 予約された音と、ゲインの変化を記録する
function fakeCtx() {
  const log = { oscs: [] };
  return {
    log, currentTime: 10, destination: {},
    createOscillator() {
      const o = { type: null, freq: [], connect() {}, start(t) { o.startAt = t; }, stop(t) { o.stopAt = t; },
        frequency: { setValueAtTime: (f, t) => o.freq.push([f, t]) } };
      log.oscs.push(o);
      return o;
    },
    createGain() {
      const g = { ramps: [], connect() {}, gain: {
        setValueAtTime: (v, t) => g.ramps.push(["set", v, t]),
        linearRampToValueAtTime: (v, t) => g.ramps.push(["linear", v, t]),
        exponentialRampToValueAtTime: (v, t) => g.ramps.push(["exp", v, t]) } };
      (log.gains ||= []).push(g);
      return g;
    },
  };
}

test("音の仕様(周波数・開始・長さ)", () => {
  assert.deepEqual(CHIMES.toBreak, [[880, 0.0, 0.22], [659.25, 0.2, 0.45]]);
  assert.deepEqual(CHIMES.toWork, [[659.25, 0.0, 0.22], [880, 0.2, 0.45]]);
  assert.deepEqual(CHIMES.toLong, [[1046.5, 0.0, 0.25], [783.99, 0.25, 0.25], [659.25, 0.5, 0.25], [523.25, 0.75, 1.1]]);
});
test("フェーズの変化と音の対応", () => {
  assert.equal(chimeKindFor("work", "short_break"), "toBreak");
  assert.equal(chimeKindFor("work", "long_break"), "toLong");
  assert.equal(chimeKindFor("short_break", "work"), "toWork");
  assert.equal(chimeKindFor("long_break", "work"), "toWork");
});
test("scheduleChime: sine・アタック0.015秒・各音の末尾へ指数減衰・開始時刻は現在時刻から", () => {
  const ctx = fakeCtx();
  assert.equal(scheduleChime(ctx, "toLong", 100), 4);
  CHIMES.toLong.forEach(([freq, offset, dur], i) => {
    const o = ctx.log.oscs[i], g = ctx.log.gains[i];
    assert.equal(o.type, "sine");
    assert.deepEqual(o.freq, [[freq, 10 + offset]]);
    assert.equal(o.startAt, 10 + offset);
    assert.ok(o.stopAt >= 10 + offset + dur);
    const peak = volumeToPeak(100);
    assert.deepEqual(g.ramps, [
      ["set", SILENCE, 10 + offset],
      ["linear", peak, 10 + offset + ATTACK_SEC],
      ["exp", SILENCE, 10 + offset + dur],
    ]);
  });
  assert.equal(ATTACK_SEC, 0.015);
});
test("音量: 0 なら鳴らさない / 大きいほど振幅が大きい / 範囲外は丸める", () => {
  assert.equal(scheduleChime(fakeCtx(), "toBreak", 0), 0);
  assert.ok(volumeToPeak(80) > volumeToPeak(40));
  assert.equal(volumeToPeak(500), volumeToPeak(100));
  assert.equal(volumeToPeak(-5), 0);
  assert.ok(volumeToPeak(100) < 1);
});
test("未知の種類は何もしない", () => assert.equal(scheduleChime(fakeCtx(), "nope", 50), 0));
