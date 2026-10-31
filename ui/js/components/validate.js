// Study Tracker v3 - 追加・編集フォームの入力チェック(形だけの確認。ポイント計算などのロジックは Python 側)
// 戻り値は { ok: true, ... } か { ok: false, field, message }。field は、朱色にして focus する入力欄を指す印。

export const toHalfWidth = (s) =>
  String(s ?? "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[．，]/g, ".");

const daysIn = (y, m) => new Date(y, m, 0).getDate();
const pad = (n, w) => String(n).padStart(w, "0");

export function validateRequired(value, message) {
  return String(value ?? "").trim() ? { ok: true } : { ok: false, message };
}

// 年・月・日(文字列3つ)。扱える年は 1000〜9999(日付入力欄の「＋/−」と同じ範囲)
export function validateDateParts(yStr, mStr, dStr) {
  const num = (s) => (/^\s*\d+\s*$/.test(toHalfWidth(s)) ? parseInt(toHalfWidth(s), 10) : NaN);
  const y = num(yStr), m = num(mStr), d = num(dStr);
  if (!(y >= 1000 && y <= 9999)) return { ok: false, field: "y", message: "年は4桁の数字で入力してください(例: 2026)" };
  if (!(m >= 1 && m <= 12)) return { ok: false, field: "m", message: "月は1〜12の数字で入力してください" };
  const max = daysIn(y, m);
  if (!(d >= 1 && d <= max)) return { ok: false, field: "d", message: `${m}月の日は1〜${max}の数字で入力してください` };
  return { ok: true, iso: `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}` };
}

// 目標時間(時間単位の数字)。0以下・数字でないものは不可
export function validateGoalHours(str) {
  const text = toHalfWidth(str).trim();
  const hours = /^\d+(\.\d+)?$/.test(text) ? parseFloat(text) : NaN;
  if (!Number.isFinite(hours) || hours <= 0) {
    return { ok: false, field: "goal", message: "目標時間は0より大きい数字で入力してください(例: 25 や 12.5)" };
  }
  return { ok: true, hours, minutes: Math.round(hours * 60) };
}

// 試験(追加・編集): 試験名 → 日付 → 目標時間 の順に調べ、最初の問題だけを返す
export function validateExamForm({ name, y, m, d, goalHours }) {
  if (!String(name ?? "").trim()) return { ok: false, field: "name", message: "試験名を入力してください" };
  const date = validateDateParts(y, m, d);
  if (!date.ok) return { ok: false, field: `date-${date.field}`, message: date.message };
  const goal = validateGoalHours(goalHours);
  if (!goal.ok) return { ok: false, field: "goal", message: goal.message };
  return { ok: true, name: String(name).trim(), dateStr: date.iso, goalMinutes: goal.minutes };
}

export function validateTagName(name) {
  const n = String(name ?? "").trim();
  return n ? { ok: true, name: n } : { ok: false, field: "name", message: "タグ名を入力してください" };
}

// 手動記録: 日付 → 時間(空)。時間の形式は Python(parse_duration)が唯一の判定者なので、ここでは空だけを見る
export function validateManualRecord({ y, m, d, duration }) {
  const date = validateDateParts(y, m, d);
  if (!date.ok) return { ok: false, field: `date-${date.field}`, message: date.message };
  if (!String(duration ?? "").trim()) return { ok: false, field: "duration", message: "勉強時間を入力してください(例: 1h30m)" };
  return { ok: true, dateStr: date.iso, durationText: String(duration).trim() };
}
