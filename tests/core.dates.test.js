import test from "node:test";
import assert from "node:assert/strict";
import { isoOf, todayIso, nowHHMM, parseIso, isValidIso, addDaysIso, daysBetween, weekdayMon0, daysInMonth, setClock } from "../ui/js/core/dates.js";

test("今日の日付は現地の日付(UTC に変換して前日になることがない)", () => {
  // 現地時間で 2026-10-27 の 00:05 / 08:30 / 23:59 を作る(どのタイムゾーンで動かしても現地時間の日付)
  for (const [h, m] of [[0, 5], [8, 30], [23, 59]]) {
    assert.equal(todayIso(new Date(2026, 9, 27, h, m)), "2026-10-27");
  }
  assert.equal(nowHHMM(new Date(2026, 9, 27, 8, 5)), "08:05");
});

test("時計を固定できる", () => {
  const restore = setClock(() => new Date(2026, 0, 1, 12, 0));
  assert.equal(todayIso(), "2026-01-01");
  restore();
  assert.notEqual(todayIso(), "2026-01-01");
});

test("日付の足し引きは暦どおり(月末・年末・うるう日・夏時間の切り替え日)", () => {
  assert.equal(addDaysIso("2026-01-31", 1), "2026-02-01");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysIso("2028-02-28", 1), "2028-02-29");
  assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysIso("2026-03-08", 1), "2026-03-09");   // 米国の夏時間開始日
  assert.equal(addDaysIso("2026-11-01", 1), "2026-11-02");   // 米国の夏時間終了日
  assert.equal(daysBetween("2026-10-01", "2026-10-27"), 26);
  assert.equal(daysBetween("2026-10-27", "2026-10-01"), -26);
  assert.equal(daysBetween("2026-03-07", "2026-03-10"), 3);
});

test("曜日は Python 版と同じ(月曜=0)", () => {
  assert.equal(weekdayMon0("2026-10-26"), 0);   // 月曜
  assert.equal(weekdayMon0("2026-10-27"), 1);   // 火曜
  assert.equal(weekdayMon0("2026-11-01"), 6);   // 日曜
});

test("不正な日付は例外", () => {
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-1", "20261027", "", null, undefined, "2026-10-27T00:00"]) {
    assert.equal(isValidIso(bad), false, String(bad));
  }
  assert.deepEqual(parseIso("2026-10-27"), { y: 2026, m: 10, d: 27 });
  assert.equal(isoOf(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
});
