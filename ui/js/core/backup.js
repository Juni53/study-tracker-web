// 完全バックアップ: ファイルの形式・検証・要約・リマインダーの判定。ブラウザや保存層には触れない(純粋な処理)。
//
// バックアップの形式("study-tracker-backup"):
//   { format, schemaVersion, app: {name, version, platform}, exported_at, files: { "records.json": [...], ... } }
//   files は、保存層の 11 個の JSON(F の名前)そのまま。ファイルが無いものは「既定値のまま」を意味する。
// デスクトップ版の移行バンドル("study-tracker-desktop-bundle", tools/export_desktop_data.py の出力)も、同じ入口で読める。
//   { format, version, exported_at, source_platform, files: {...} }

import { FILE_NAMES, F } from "./defaults.js";
import { isValidIso, daysBetween } from "./dates.js";

export const BACKUP_FORMAT = "study-tracker-backup";
export const DESKTOP_BUNDLE_FORMAT = "study-tracker-desktop-bundle";
export const SCHEMA_VERSION = 1;
export const APP_VERSION = "3.0.0";

export function buildBackup(files, exportedAt) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    app: { name: "Study Tracker", version: APP_VERSION, platform: "web" },
    exported_at: exportedAt,
    files,
  };
}

export const backupFilename = (todayIso) => `study_tracker_backup_${todayIso}.json`;

// ── 検証 ──
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const isInt = (x) => Number.isInteger(x);
const isStr = (x) => typeof x === "string";
const isIntArray = (x) => Array.isArray(x) && x.every(isInt);

// 各ファイルの検証。問題があれば、メッセージの配列を返す(空なら正常)。アプリが前提にしている型だけを確かめる。
const VALIDATORS = {
  [F.records]: (v) => {
    if (!Array.isArray(v)) return ["配列ではありません"];
    const errs = [], ids = new Set();
    v.forEach((r, i) => {
      const at = `${i + 1}件目`;
      if (!isObj(r)) return errs.push(`${at}: 記録の形式が正しくありません`);
      if (!isInt(r.id)) errs.push(`${at}: id が整数ではありません`);
      else if (ids.has(r.id)) errs.push(`${at}: id が重複しています(${r.id})`);
      else ids.add(r.id);
      if (!isValidIso(r.date)) errs.push(`${at}: 日付が正しくありません(${r.date})`);
      if (!isNum(r.minutes) || r.minutes < 0) errs.push(`${at}: 時間(分)が正しくありません(${r.minutes})`);
      if ("tag_ids" in r && !isIntArray(r.tag_ids)) errs.push(`${at}: tag_ids が正しくありません`);
      if ("exam_ids" in r && !isIntArray(r.exam_ids)) errs.push(`${at}: exam_ids が正しくありません`);
      if ("points_earned" in r && !isNum(r.points_earned)) errs.push(`${at}: points_earned が数値ではありません`);
      if ("content" in r && r.content !== null && !isStr(r.content)) errs.push(`${at}: content が文字列ではありません`);
      if ("start_time" in r && r.start_time !== null && !isStr(r.start_time)) errs.push(`${at}: start_time が文字列ではありません`);
    });
    return errs;
  },
  [F.points]: (v) => {
    if (!isObj(v)) return ["オブジェクトではありません"];
    const errs = [];
    if (!isNum(v.balance)) errs.push("balance が数値ではありません");
    if (!Array.isArray(v.history)) errs.push("history が配列ではありません");
    else v.history.forEach((h, i) => {
      if (!isObj(h) || !isStr(h.ts) || !isNum(h.delta) || !isStr(h.reason)) errs.push(`履歴の${i + 1}件目: 形式が正しくありません`);
    });
    return errs;
  },
  [F.rewards]: (v) => !Array.isArray(v) ? ["配列ではありません"]
    : v.flatMap((r, i) => (isObj(r) && isInt(r.id) && isStr(r.name) && isNum(r.cost) ? [] : [`${i + 1}件目: 報酬の形式が正しくありません`])),
  [F.settings]: (v) => {
    if (!isObj(v)) return ["オブジェクトではありません"];
    return "pomodoro" in v && v.pomodoro !== null && !isObj(v.pomodoro) ? ["pomodoro がオブジェクトではありません"] : [];
  },
  [F.exams]: (v) => !Array.isArray(v) ? ["配列ではありません"]
    : v.flatMap((e, i) => (isObj(e) && isInt(e.id) && isStr(e.name) && isValidIso(e.date) ? [] : [`${i + 1}件目: 試験の形式が正しくありません`])),
  [F.tags]: (v) => !Array.isArray(v) ? ["配列ではありません"]
    : v.flatMap((t, i) => (isObj(t) && isInt(t.id) && isStr(t.name) ? [] : [`${i + 1}件目: タグの形式が正しくありません`])),
  [F.milestones]: (v) => (Array.isArray(v) && v.every(isStr) ? [] : ["文字列の配列ではありません"]),
  [F.sabori]: (v) => (Array.isArray(v) && v.every(isValidIso) ? [] : ["日付の配列ではありません"]),
  [F.saboriOwned]: (v) => (isObj(v) && isInt(v.owned) && v.owned >= 0 ? [] : ["owned が0以上の整数ではありません"]),
  [F.launchLog]: (v) => (Array.isArray(v) && v.every(isValidIso) ? [] : ["日付の配列ではありません"]),
  [F.decay]: (v) => (isObj(v) && (!("last_applied" in v) || isStr(v.last_applied)) ? [] : ["last_applied が文字列ではありません"]),
};

const MAX_REPORT = 8;

// 読み込んだ JSON(オブジェクト)を検証する。→ {ok, error?, problems[], format, exportedAt, appVersion, files, ignored[]}
// 1つでも問題があれば ok:false(一部だけ取り込む、ということはしない)。
export function validateBackup(obj) {
  const fail = (error, problems = []) => ({ ok: false, error, problems });
  if (!isObj(obj)) return fail("Study Tracker のバックアップではありません(形式が違います)");
  let format;
  if (obj.format === BACKUP_FORMAT) {
    format = "backup";
    if (!isInt(obj.schemaVersion) || obj.schemaVersion < 1) return fail("バックアップの版が正しくありません");
    if (obj.schemaVersion > SCHEMA_VERSION) return fail("新しい版のアプリで作られたバックアップのため、読み込めません。アプリを更新してから、もう一度お試しください");
  } else if (obj.format === DESKTOP_BUNDLE_FORMAT) {
    format = "desktop";
    if (!isInt(obj.version) || obj.version < 1) return fail("デスクトップ版データの版が正しくありません");
    if (obj.version > 1) return fail("新しい形式のデスクトップ版データのため、読み込めません");
  } else {
    return fail("Study Tracker のバックアップではありません(形式が違います)");
  }
  if (!isObj(obj.files)) return fail("バックアップの中身(files)がありません");

  const files = {}, ignored = [], problems = [];
  for (const [name, value] of Object.entries(obj.files)) {
    if (!FILE_NAMES.includes(name)) { ignored.push(name); continue; }
    const errs = VALIDATORS[name](value);
    errs.slice(0, 3).forEach((m) => problems.push(`${name}: ${m}`));
    if (errs.length > 3) problems.push(`${name}: ほか ${errs.length - 3} 件の問題`);
    files[name] = value;
  }
  if (problems.length) return fail("バックアップの内容に問題があるため、読み込めません", problems.slice(0, MAX_REPORT));
  if (!Object.keys(files).length) return fail("バックアップに、取り込めるデータが含まれていません");
  return {
    ok: true, format, files, ignored,
    exportedAt: isStr(obj.exported_at) ? obj.exported_at : null,
    appVersion: format === "backup" && isObj(obj.app) && isStr(obj.app.version) ? obj.app.version : null,
  };
}

// テキスト → 検証済みバックアップ。JSON として読めなければ、その旨のエラー。
export function parseBackupText(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { return { ok: false, error: "ファイルを読み込めませんでした(JSON として読めません)", problems: [] }; }
  return validateBackup(obj);
}

// ── 要約(確認画面・状態の表示用) ──
export function summarizeFiles(files) {
  const records = Array.isArray(files[F.records]) ? files[F.records] : [];
  const dates = records.map((r) => r.date).sort();
  return {
    records: records.length,
    first_date: dates[0] ?? null,
    last_date: dates.at(-1) ?? null,
    total_min: records.reduce((a, r) => a + r.minutes, 0),
    points_balance: files[F.points] ? files[F.points].balance : 0,
    tags: Array.isArray(files[F.tags]) ? files[F.tags].length : null,       // null = ファイルが無い(既定のタグ)
    exams: Array.isArray(files[F.exams]) ? files[F.exams].length : 0,
    rewards: Array.isArray(files[F.rewards]) ? files[F.rewards].length : 0,
  };
}

// ── リマインダー ──
export const REMINDER_CHOICES = [7, 14, 30, 0];          // 日数。0 = 通知しない

export function defaultBackupPrefs(today) {
  return { interval_days: 7, last_backup_at: null, snoozed_until: null, first_seen: today };
}

// 最後のバックアップ(まだなら、アプリを使い始めた日)から周期がたち、延期中でなく、記録があるなら true。
export function isBackupDue(prefs, today, recordCount) {
  if (!(prefs.interval_days > 0) || recordCount <= 0) return false;
  if (prefs.snoozed_until && today < prefs.snoozed_until) return false;
  const base = prefs.last_backup_at ? prefs.last_backup_at.slice(0, 10) : prefs.first_seen;
  return isValidIso(base) && daysBetween(base, today) >= prefs.interval_days;
}

export const daysSinceBackup = (prefs, today) =>
  prefs.last_backup_at && isValidIso(prefs.last_backup_at.slice(0, 10)) ? daysBetween(prefs.last_backup_at.slice(0, 10), today) : null;
