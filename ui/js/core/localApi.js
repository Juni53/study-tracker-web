// UI から呼ばれる API。Python 版 api.py(pywebview の js_api)の移植。
//
// ・メソッド名と戻り値の形は Python 版と同じ(UI の views/ を書き換えないため)。
// ・Python の None は JS では null で返すこと(undefined にしない)。
// ・まだ移植していないメソッドは NotPortedError を投げる。移植が進むごとに、実装へ置き換える。

import { DataManager } from "./dataManager.js";
import { parseDuration, toPyFloat, pyInt } from "./duration.js";
import { calcBasePoints, calcManualPoints } from "./formula.js";
import { pyRound, floorDiv } from "./num.js";
import { unsupportedPlatform } from "./platform.js";
import { F } from "./defaults.js";
import { nowIsoSeconds, isValidIso } from "./dates.js";
import { buildBackup, backupFilename, parseBackupText, summarizeFiles, defaultBackupPrefs, isBackupDue, daysSinceBackup } from "./backup.js";
import { todayIso, addDaysIso, daysBetween, weekdayMon0 } from "./dates.js";

// Python 版 Api の公開メソッド(tests/golden/api_surface.json と一致することをテストで確認する)
export const API_METHODS = [
  "get_home_data", "get_points_balance", "get_calendar_month", "get_stats",
  "add_record", "preview_points", "update_record", "delete_record", "get_records",
  "get_exams", "add_exam", "update_exam", "delete_exam",
  "get_tags", "add_tag", "update_tag", "delete_tag", "reorder_tags",
  "get_shop", "add_reward", "update_reward", "set_reward_flag", "set_reward_order", "delete_reward",
  "buy_reward", "buy_sabori_ticket", "get_reward_cost_reference",
  "get_settings", "update_setting", "notify_desktop", "set_idle_inhibit", "calc_formula_preview",
  "open_data_folder", "reset_all_data", "export_csv", "import_csv",
];

// Web 版だけにある API(Python 版には無いので、API_METHODS とは別に管理する)
export const WEB_ONLY_METHODS = [
  "request_notification_permission", "get_storage_info", "reload_app",
  "get_backup_status", "save_backup", "set_backup_interval", "snooze_backup_reminder",
  "pick_backup_file", "apply_backup", "undo_last_restore",
];

export class NotPortedError extends Error {
  constructor(method) { super(`api.${method} は、まだ Web 版に移植していません`); this.name = "NotPortedError"; }
}

export class Api {
  // platform: ブラウザ固有の機能(core/platform.js)。persistence: 起動時に求めた「永続化」の結果。
  constructor(store, { platform = unsupportedPlatform, persistence = null } = {}) {
    this.store = store;
    this.platform = platform;
    this.persistence = persistence;
    this.dm = new DataManager(store);
    this.dm.runStartupTasks();   // さぼり券の自動適用 → 消失判定、の順で1回だけ(アプリを開いたときに実行される)
  }

  // ── ホーム ──
  get_home_data() {
    const dm = this.dm;
    const [streak, streakState] = dm.streakInfo();
    const step = Object.prototype.hasOwnProperty.call(dm.settings, "streak_bonus_days") ? dm.settings.streak_bonus_days : 7;
    const nextBonus = step > 0 ? (floorDiv(streak, step) + 1) * step : null;

    const todayMin = dm.statsToday();
    const monthMin = dm.statsMonth();
    const monthGoal = Object.prototype.hasOwnProperty.call(dm.settings, "monthly_goal_min") ? dm.settings.monthly_goal_min : 3000;

    const today = todayIso();
    const upcoming = dm.upcomingExams();
    let nearestExam = null;
    if (upcoming.length) {
      const e = upcoming[0];
      const [done, goal, ratio] = dm.examProgress(e);
      const daysLeft = daysBetween(today, e.date);
      let elapsedRatio = 0.0;
      if (e.created_date) {
        const totalSpan = daysBetween(e.created_date, e.date);
        const passed = daysBetween(e.created_date, today);
        elapsedRatio = totalSpan > 0 ? Math.min(Math.max(passed / totalSpan, 0), 1) : 1.0;
      }
      const sameDayExtra = upcoming.filter((x) => x.date === e.date).length - 1;
      nearestExam = {
        id: e.id, name: e.name, date: e.date, days_left: daysLeft,
        progress_pct: pyRound(ratio * 100), elapsed_pct: pyRound(elapsedRatio * 100),
        done_min: done, goal_min: goal, same_day_extra: sameDayExtra,
      };
    }

    const byDate = dm.statsByDate();
    const monday = addDaysIso(today, -weekdayMon0(today));   // 月曜始まり・今週の範囲に固定(先週分は含めない)
    const week = [];
    for (let i = 0; i < 7; i++) {
      const iso = addDaysIso(monday, i);
      const recs = dm.records.filter((r) => r.date === iso);
      week.push({
        date: iso, weekday: "月火水木金土日"[i],
        minutes: byDate[iso] ?? 0, is_today: iso === today,
        tag_ids: [...new Set(recs.flatMap((r) => r.tag_ids || []))].sort((a, b) => a - b),
      });
    }

    const tagTotals = dm.tagSummaryAll();
    const totalAll = Object.values(tagTotals).reduce((a, x) => a + x, 0) || 1;
    const tagsBreakdown = dm.tags.filter((t) => tagTotals[t.id]).map((t) => ({
      id: t.id, name: t.name, color: t.color,
      minutes: tagTotals[t.id] ?? 0,
      pct: pyRound((tagTotals[t.id] ?? 0) / totalAll * 100),
    }));

    const history = dm.points.history.slice(-4).reverse();
    const has = (k, d) => (Object.prototype.hasOwnProperty.call(dm.settings, k) ? dm.settings[k] : d);
    return {
      points_balance: dm.points.balance,
      streak, streak_state: streakState, next_bonus_days: nextBonus,
      today_min: todayMin, daily_goal_min: has("daily_goal_min", 120),
      month_min: monthMin, month_goal_min: monthGoal,
      nearest_exam: nearestExam,
      week,
      tags_breakdown: tagsBreakdown,
      points_history: history,
      tags: dm.tags,
    };
  }

  get_points_balance() { return this.dm.points.balance; }

  // ── カレンダー ──
  get_calendar_month(year, month, weekStart = 0) {
    return this.dm.calendarMonth(pyInt(year), pyInt(month), pyInt(weekStart));
  }

  // ── 統計 ──
  get_stats(period) { return this.dm.statsPeriod(period); }

  // ── 記録 ──
  add_record(dateStr, durationText, content, tagIds, examIds, source, quality = 3, startTime = null) {
    let minutes;
    try { minutes = parseDuration(durationText); } catch { return { ok: false, error: "時間の形式を認識できません" }; }
    const rec = this.dm.addRecord(dateStr, minutes, content, tagIds, examIds, source, quality, startTime);
    return { ok: true, record: rec };
  }

  update_record(recId, patch) {
    const [ok, err] = this.dm.updateRecord(recId, patch);
    return { ok, error: err };
  }

  delete_record(recId) { return { ok: this.dm.deleteRecord(recId) }; }

  get_records() { return this.dm.records; }

  // ── 試験 ──
  get_exams() {
    return this.dm.exams.map((e) => {
      const [done, , ratio] = this.dm.examProgress(e);
      return { ...e, done_min: done, progress_pct: pyRound(ratio * 100) };
    });
  }

  add_exam(name, dateStr, goalMinutes, goalBonusPoints = null) { return this.dm.addExam(name, dateStr, goalMinutes, goalBonusPoints); }
  update_exam(examId, name, dateStr, goalMinutes) { return { ok: this.dm.updateExam(examId, name, dateStr, goalMinutes) }; }
  delete_exam(examId) { this.dm.deleteExam(examId); return { ok: true }; }

  // ── タグ ──
  get_tags() { return this.dm.tags; }
  add_tag(name, color) { return this.dm.addTag(name, color); }
  update_tag(tagId, name, color) { return { ok: this.dm.updateTag(tagId, name, color) }; }
  delete_tag(tagId) { this.dm.deleteTag(tagId); return { ok: true }; }
  reorder_tags(orderedIds) { this.dm.reorderTags(orderedIds); return { ok: true }; }

  // ── ショップ ──
  get_shop() { return this.dm.shopData(); }

  add_reward(name, cost, favorite = false, goal = false) {
    const [reward, err] = this.dm.addReward(name, cost, favorite, goal);
    return { ok: reward !== null, error: err, reward };
  }

  update_reward(rewardId, name, cost) {
    const [reward, err] = this.dm.updateReward(rewardId, name, cost);
    return { ok: reward !== null, error: err, reward };
  }

  set_reward_flag(rewardId, favorite = null, goal = null) { return { ok: this.dm.setRewardFlag(rewardId, favorite, goal) }; }

  set_reward_order(orderedIds) {
    const [ok, err] = this.dm.setRewardOrder(orderedIds);
    return { ok, error: err };
  }

  delete_reward(rewardId) { this.dm.deleteReward(rewardId); return { ok: true }; }

  buy_reward(rewardId, qty = 1) {
    const [ok, err] = this.dm.buyReward(rewardId, qty);
    return { ok, error: err, points_balance: this.dm.points.balance };
  }

  buy_sabori_ticket() {
    const [ok, err] = this.dm.buySaboriTicket();
    return { ok, error: err, points_balance: this.dm.points.balance, owned: this.dm.saboriOwned() };
  }

  get_reward_cost_reference(cost, runHours = 2) {
    let c;
    try { c = toPyFloat(cost); } catch { c = 0.0; }
    return this.dm.rewardCostReference(Math.max(c, 0.0), pyInt(runHours));
  }

  // ── データ管理 ──
  // CSV は、ブラウザのダウンロードとして書き出す(保存先はブラウザのダウンロード先)。
  export_csv() {
    const filename = `study_export_${todayIso()}.csv`;
    const r = this.platform.download(filename, this.dm.exportCsvText(), "text/csv;charset=utf-8");
    return r.ok ? { ok: true, path: filename } : { ok: false, error: r.error };
  }

  // ファイル選択ダイアログで CSV を選んでもらい、記録を取り込む。選ばずに閉じたときは {ok: true, cancelled: true}。
  async import_csv() {
    let picked;
    try { picked = await this.platform.pickFile({ accept: ".csv,text/csv" }); }
    catch (e) { return { ok: false, error: e.message }; }
    if (!picked) return { ok: true, cancelled: true };
    return this.dm.importCsv(picked.bytes);
  }

  // このブラウザに保存されたデータをすべて消して、再読み込みする。
  async reset_all_data() {
    await this.store.clearAll();
    this.platform.reload();
    return { ok: true };
  }

  // Web 版には「保存フォルダ」が無い(データはブラウザの中)。画面からは呼ばれない。
  open_data_folder() { return { ok: false, unsupported: true }; }

  // 保存先・容量・永続化の状態(設定ページの表示用。Web 版だけの API)
  async get_storage_info() {
    const est = await this.platform.storageEstimate();
    return {
      volatile: this.store.volatile,
      persisted: this.persistence && this.persistence.supported ? this.persistence.persisted : null,   // null = このブラウザは非対応
      usage: est ? est.usage : null, quota: est ? est.quota : null,
    };
  }

  // ── 通知・画面消灯防止 ──
  async notify_desktop(title, message) { return this.platform.notify(title, message); }
  set_idle_inhibit(on) { return this.platform.setWakeLock(on); }
  // 通知の許可を求める(ユーザーの操作の直後に呼ぶ)。Web 版だけの API。
  async request_notification_permission() { return { permission: await this.platform.requestNotificationPermission() }; }

  // ── 完全バックアップ・復元(Web 版だけの API) ──
  // リマインダーの設定(周期・最後のバックアップ・延期)は、バックアップの対象外の「メタ情報」に持つ。
  _backupPrefs() {
    let p = this.store.getMeta("backup_prefs", null);
    if (!p) { p = defaultBackupPrefs(todayIso()); this.store.setMeta("backup_prefs", p); }
    return { ...p };
  }
  _setBackupPrefs(p) { this.store.setMeta("backup_prefs", p); }

  get_backup_status() {
    const p = this._backupPrefs();
    const today = todayIso();
    const undo = this.store.getMeta("pre_restore_snapshot", null);
    return {
      interval_days: p.interval_days,
      last_backup_at: p.last_backup_at,
      days_since: daysSinceBackup(p, today),
      due: isBackupDue(p, today, this.dm.records.length),
      record_count: this.dm.records.length,
      undo: undo ? { saved_at: undo.saved_at, reason: undo.reason } : null,
      can_pick_location: this.platform.savePickerSupported ? this.platform.savePickerSupported() : false,
    };
  }

  // 全データを1つの JSON にして保存する。保存先を選べるブラウザ(Chrome / Edge)では選んでもらい、他はダウンロード。
  async save_backup() {
    const files = this.store.exportAll();
    const text = JSON.stringify(buildBackup(files, nowIsoSeconds()));
    const r = await this.platform.saveFile(backupFilename(todayIso()), text, "application/json");
    if (r.cancelled) return { ok: true, cancelled: true };
    if (!r.ok) return { ok: false, error: r.error };
    this._setBackupPrefs({ ...this._backupPrefs(), last_backup_at: nowIsoSeconds(), snoozed_until: null });
    await this.store.flush().catch(() => {});
    return { ok: true, filename: r.filename, method: r.method, records: this.dm.records.length, size: text.length };
  }

  set_backup_interval(days) {
    if (!Number.isInteger(days) || days < 0 || days > 365) return { ok: false, error: "周期は 0〜365 日で指定してください" };
    this._setBackupPrefs({ ...this._backupPrefs(), interval_days: days, snoozed_until: null });
    return { ok: true };
  }

  // 「あとで」: 明日まで、リマインダーを出さない
  snooze_backup_reminder() {
    this._setBackupPrefs({ ...this._backupPrefs(), snoozed_until: addDaysIso(todayIso(), 1) });
    return { ok: true };
  }

  _currentSummary() {
    const dm = this.dm;
    return summarizeFiles({ [F.records]: dm.records, [F.points]: dm.points, [F.tags]: dm.tags, [F.exams]: dm.exams, [F.rewards]: dm.rewards });
  }

  // ファイルを選んでもらい、検証して、内容の要約を返す(まだ何も変更しない)。続けて apply_backup で実行する。
  async pick_backup_file() {
    this._pendingBackup = null;
    let picked;
    try { picked = await this.platform.pickFile({ accept: ".json,application/json" }); }
    catch (e) { return { ok: false, error: e.message, problems: [] }; }
    if (!picked) return { ok: true, cancelled: true };
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(picked.bytes); }
    catch { return { ok: false, error: "ファイルを読み込めませんでした(UTF-8 の JSON ではありません)", problems: [] }; }
    const v = parseBackupText(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    if (!v.ok) return { ok: false, error: v.error, problems: v.problems };
    this._pendingBackup = { name: picked.name, v };
    return {
      ok: true,
      summary: {
        name: picked.name, format: v.format, exported_at: v.exportedAt, app_version: v.appVersion, ignored: v.ignored,
        incoming: summarizeFiles(v.files), current: this._currentSummary(),
      },
    };
  }

  // 復元の直前のデータを、1つだけ控えておく(undo_last_restore で戻せる)。
  async _saveUndoSnapshot(reason) {
    this.store.setMeta("pre_restore_snapshot", { saved_at: nowIsoSeconds(), reason, files: this.store.exportAll() });
    await this.store.flush();
  }

  // mode: "replace"(いまのデータをすべて置き換える)/ "merge"(記録だけ統合する)。実行前に、いまのデータを控える。
  async apply_backup(mode) {
    const pending = this._pendingBackup;
    if (!pending) return { ok: false, error: "復元するバックアップが選ばれていません" };
    if (mode !== "replace" && mode !== "merge") return { ok: false, error: "復元の方法が正しくありません" };
    const files = pending.v.files;
    if (mode === "merge" && !Array.isArray(files[F.records])) return { ok: false, error: "このバックアップには、統合できる記録が含まれていません" };
    await this._saveUndoSnapshot(mode === "replace" ? "上書き復元の直前" : "記録の統合の直前");
    let result;
    if (mode === "replace") {
      await this.store.replaceFiles(files);
      this.dm = new DataManager(this.store);
      const at = pending.v.exportedAt;
      this._setBackupPrefs({ ...this._backupPrefs(), last_backup_at: at && isValidIso(at.slice(0, 10)) ? at : nowIsoSeconds(), snoozed_until: null });
      result = { ok: true, mode, records: this.dm.records.length };
    } else {
      result = { ok: true, mode, ...this.dm.mergeRecordsFrom(files) };
    }
    this._pendingBackup = null;
    await this.store.flush();
    return result;
  }

  // 直前の復元(または統合)の前の状態に戻す。
  async undo_last_restore() {
    const snap = this.store.getMeta("pre_restore_snapshot", null);
    if (!snap) return { ok: false, error: "戻せる状態がありません" };
    await this.store.replaceFiles(snap.files);
    this.dm = new DataManager(this.store);
    this.store.setMeta("pre_restore_snapshot", null);
    await this.store.flush();
    return { ok: true, records: this.dm.records.length, saved_at: snap.saved_at };
  }

  reload_app() { this.platform.reload(); return { ok: true }; }

  // ── 設定 ──
  get_settings() { return this.dm.settings; }

  update_setting(key, value) {
    // 値が無い(undefined)設定は、保存しない。(JSON にできず、既定値を打ち消してしまう壊れた設定になるため)
    if (value === undefined) return { ok: false, error: "設定の値が指定されていません" };
    this.dm.settings[key] = value;
    this.dm.saveSettings();
    return { ok: true };
  }

  calc_formula_preview(formula, minutes) {
    return { points: calcBasePoints(minutes, formula) };
  }

  preview_points(durationText, source) {
    let minutes;
    try { minutes = parseDuration(durationText); } catch { return { ok: false }; }
    const s = this.dm.settings;
    if (source === "stopwatch") {
      const base = calcBasePoints(minutes, s.point_formula);
      return { ok: true, minutes, points: pyRound(base, 2), base_points: pyRound(base, 2), multiplier: 1.0 };
    }
    const [manual, base] = calcManualPoints(minutes, s.point_formula, s.manual_point_formula);
    const multiplier = base ? pyRound(manual / base, 2) : 0.0;
    return { ok: true, minutes, points: pyRound(manual, 2), base_points: pyRound(base, 2), multiplier };
  }
}

// 未移植のメソッドを、はっきりしたエラーにする
for (const name of API_METHODS) {
  if (!Object.prototype.hasOwnProperty.call(Api.prototype, name)) {
    Api.prototype[name] = function () { throw new NotPortedError(name); };
  }
}
