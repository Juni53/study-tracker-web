import test from "node:test";
import assert from "node:assert/strict";
import { validateDateParts, validateGoalHours, validateExamForm, validateTagName, validateManualRecord, toHalfWidth } from "../ui/js/components/validate.js";

test("日付: 正しい日付は ISO に整形される", () => {
  assert.deepEqual(validateDateParts("2026", "3", "9"), { ok: true, iso: "2026-03-09" });
  assert.equal(validateDateParts("2024", "02", "29").ok, true);      // うるう年
  assert.equal(validateDateParts("２０２６", "１０", "２６").iso, "2026-10-26"); // 全角
});
test("日付: 年・月・日それぞれの不正を、該当の欄で返す", () => {
  assert.equal(validateDateParts("", "1", "1").field, "y");
  assert.equal(validateDateParts("999", "1", "1").field, "y");
  assert.equal(validateDateParts("2026", "13", "1").field, "m");
  assert.equal(validateDateParts("2026", "", "1").field, "m");
  assert.equal(validateDateParts("2025", "2", "29").field, "d");      // 平年の2/29
  assert.equal(validateDateParts("2026", "4", "31").field, "d");
  assert.equal(validateDateParts("2026", "4", "abc").field, "d");
});
test("目標時間: 数字でない/0以下は不可、小数は可", () => {
  assert.deepEqual(validateGoalHours("25"), { ok: true, hours: 25, minutes: 1500 });
  assert.equal(validateGoalHours("12.5").minutes, 750);
  for (const bad of ["", "0", "0.0", "-3", "abc", "1h"]) assert.equal(validateGoalHours(bad).ok, false, bad);
});
test("試験: 試験名 → 日付 → 目標時間 の順に、最初の問題を返す", () => {
  const base = { name: "期末", y: "2026", m: "12", d: "1", goalHours: "20" };
  assert.equal(validateExamForm(base).ok, true);
  assert.equal(validateExamForm({ ...base, name: "  " }).field, "name");
  assert.equal(validateExamForm({ ...base, name: "", m: "13" }).field, "name"); // 名前が先
  assert.equal(validateExamForm({ ...base, m: "13" }).field, "date-m");
  assert.equal(validateExamForm({ ...base, goalHours: "0" }).field, "goal");
  assert.equal(validateExamForm({ ...base, name: " 期末 " }).name, "期末");
});
test("タグ: タグ名は必須", () => {
  assert.equal(validateTagName("").ok, false);
  assert.equal(validateTagName("   ").field, "name");
  assert.equal(validateTagName(" 生物 ").name, "生物");
});
test("手動記録: 日付 → 時間(空)。内容(タイトル)は必須ではない。形式は Python が判定する", () => {
  const base = { y: "2026", m: "10", d: "26", duration: "1h30m" };
  assert.equal(validateManualRecord(base).ok, true);
  assert.equal(validateManualRecord({ ...base, duration: "" }).field, "duration");
  assert.equal(validateManualRecord({ ...base, duration: "  " }).field, "duration");
  assert.equal(validateManualRecord({ ...base, duration: "xyz" }).ok, true); // 形式不正は add_record のエラーとして返る
  assert.equal(validateManualRecord({ ...base, d: "32" }).field, "date-d");
});
test("toHalfWidth", () => assert.equal(toHalfWidth("１２．５"), "12.5"));
