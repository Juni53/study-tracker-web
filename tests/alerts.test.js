import test from "node:test";
import assert from "node:assert/strict";
import { setupDom } from "./_dom.js";

setupDom();
const { stopwatch, onPhaseChange } = await import("../ui/js/store/stopwatch.js");
const { notificationText } = await import("../ui/js/store/pomodoroAlerts.js");

test("スキップで、フェーズが切り替わるたびに通知イベントが1回出る(from → to)", () => {
  const events = [];
  const off = onPhaseChange((e) => events.push(e));
  stopwatch.configurePomodoro({ work: 25, short_break: 5, long_break: 15, cycles: 2 });
  stopwatch.skipPhase();   // 作業 → 短休憩
  stopwatch.skipPhase();   // 短休憩 → 作業
  stopwatch.skipPhase();   // 作業(2周目の最後) → 長休憩
  stopwatch.skipPhase();   // 長休憩 → 作業
  off();
  assert.deepEqual(events.map((e) => `${e.from}>${e.to}`), ["work>short_break", "short_break>work", "work>long_break", "long_break>work"]);
  assert.ok(events.every((e) => e.auto === false));
});
test("購読の解除ができる / 購読側の例外でタイマーが止まらない", () => {
  let n = 0;
  const off = onPhaseChange(() => { n++; throw new Error("boom"); });
  stopwatch.skipPhase();
  assert.equal(n, 1);
  off();
  stopwatch.skipPhase();
  assert.equal(n, 1);
});
test("通知の文面", () => {
  const cfg = { work: 25, short_break: 5, long_break: 15 };
  assert.match(notificationText("work", "short_break", cfg).message, /短休憩\(5分\)/);
  assert.match(notificationText("work", "long_break", cfg).title, /長休憩/);
  assert.match(notificationText("short_break", "work", cfg).message, /作業\(25分\)/);
});
