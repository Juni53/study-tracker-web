// データ管理。Python 版 data_manager.DataManager の移植(段階的に進行中)。
//
// 現在移植済み: 読み込み(reload)・設定。記録/ポイント/試験などの中身は読み込みだけで、
// それらの操作(追加・削除・集計・連続記録・消失 など)は、次の段階で移植する。
//
// Python 版は jload / jsave で JSON ファイルを読み書きしていた。ここでは store(storage.js)の
// get / save が同じ役割。get は「ファイルが無ければ既定値」で、既定値は保存しない(Python 版と同じ)。

import { F, DEFAULT_SETTINGS, DEFAULT_TAGS } from "./defaults.js";
import { calcBasePoints, calcManualPoints } from "./formula.js";
import { pyRound, floorDiv, floorMod, pyStrip } from "./num.js";
import { toPyFloat, pyInt, pyFloat } from "./duration.js";
import { csvRow, fmtPyFloat, parseCsv, decodeCsvBytes, CsvError } from "./csv.js";
import { isValidIso } from "./dates.js";
import { todayIso, nowIsoSeconds, addDaysIso, daysBetween, parseIso, weekdayMon0, daysInMonth } from "./dates.js";

// Python の dict.get(key, default): キーがあれば、値が null でもその値を返す(?? とは違う)
const pyGet = (obj, key, def) => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def);
// Python の bool(x)(空の配列・空のオブジェクト・0・"" は偽)
const pyBool = (x) => (Array.isArray(x) ? x.length > 0 : x && typeof x === "object" ? Object.keys(x).length > 0 : Boolean(x));
// Python の list.remove(x)(最初の1つだけ取り除く)
const removeFirst = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };
const sum = (arr) => arr.reduce((a, x) => a + x, 0);
const pad = (n, w) => String(n).padStart(w, "0");
const WEEKDAYS = "月火水木金土日";
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Python の f"{x:.0f}"(偶数丸め)
const fmt0f = (x) => String(pyRound(x, 0));

const START_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DataManager {
  constructor(store) {
    this.store = store;
    this.reload();
  }

  reload() {
    const s = this.store;
    const saved = s.get(F.settings, () => ({}));
    // 値が undefined の設定は、無いものとして扱う(以前のバグで、テーマが undefined で保存されたデータも、既定値に戻る)
    const cleaned = Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined));
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...cleaned };
    // pomodoro は入れ子なので、保存済みの設定に新しい項目が無くても、既定値で補う
    const savedPomo = this.settings.pomodoro;
    this.settings.pomodoro = {
      ...DEFAULT_SETTINGS.pomodoro,
      ...(savedPomo && typeof savedPomo === "object" && !Array.isArray(savedPomo) ? savedPomo : {}),
    };
    delete this.settings.pomodoro.break_pause_always;   // 誤って追加していた項目(削除済み)を取り除く

    this.records = s.get(F.records, () => []);
    this.points = s.get(F.points, () => ({ balance: 0, history: [] }));
    this.rewards = s.get(F.rewards, () => []);
    this.exams = s.get(F.exams, () => []);
    this.tags = s.get(F.tags, () => structuredClone(DEFAULT_TAGS));
    this._migrateStreakMilestoneKeys();
  }

  // 旧形式のキー("streak_7" = これまでに1度でも付与した)を、連続期間ごとの形式("streak_7@開始日")に直す。
  // いま続いている連続記録がすでに通過した N(step の倍数)は付与済みとして新形式で記録し直す(二重付与を避けるため。
  // 過去の取りこぼし分をさかのぼって付与はしない)。終わった連続期間の分は重複判定が要らないので、旧キーは捨てる。
  _migrateStreakMilestoneKeys() {
    const achieved = this._jload(F.milestones, () => []);
    const legacy = achieved.filter((k) => /^streak_\d+$/.test(k));
    if (!legacy.length) return;
    const kept = achieved.filter((k) => !legacy.includes(k));
    const step = pyGet(this.settings, "streak_bonus_days", 7);
    const [dates, streak] = this._currentStreakDates();
    if (step > 0 && streak > 0) {
      const start = [...dates].sort()[0];
      for (let n = step; n <= streak; n += step) kept.push(`streak_${n}@${start}`);
    }
    this.store.save(F.milestones, kept);
  }

  // Python の jload 相当。毎回コピーを返すので、書き換えても save するまでは元のデータに影響しない。
  _jload(name, makeDefault) { return structuredClone(this.store.get(name, makeDefault)); }

  // ── 保存 ──
  tagById(tid) { return this.tags.find((t) => t.id === tid) ?? null; }
  nextTagId() { return Math.max(0, ...this.tags.map((t) => t.id)) + 1; }
  examById(eid) { return this.exams.find((e) => e.id === eid) ?? null; }
  nextExamId() { return Math.max(0, ...this.exams.map((e) => e.id ?? 0)) + 1; }
  nextRewardId() { return Math.max(0, ...this.rewards.map((r) => r.id ?? 0)) + 1; }

  saveTags() { this.store.save(F.tags, this.tags); }
  saveSettings() { this.store.save(F.settings, this.settings); }
  saveRewards() { this.store.save(F.rewards, this.rewards); }
  saveExams() { this.store.save(F.exams, this.exams); }
  savePoints() { this.store.save(F.points, this.points); }
  saveRecords() { this.store.save(F.records, this.records); }

  _nextRecId() { return Math.max(0, ...this.records.map((r) => r.id ?? 0)) + 1; }

  // ── 記録の追加・編集・削除 ──
  // dateStr は「計測を開始した日」。日付をまたいでもこの日付のまま。
  // startTime は「計測を開始した時刻」("HH:MM")。統計の時間帯比率用で、ストップウォッチ記録のみ渡す。無い/不正な値なら保存しない。
  addRecord(dateStr, minutes, content, tagIds, examIds, source, quality = 3, startTime = null) {
    let pts;
    if (source === "stopwatch") {
      pts = pyRound(calcBasePoints(minutes, this.settings.point_formula), 2);
    } else {
      const [manual] = calcManualPoints(minutes, this.settings.point_formula, this.settings.manual_point_formula);
      pts = pyRound(manual, 2);
    }
    const rec = {
      id: this._nextRecId(), date: dateStr, minutes, content,
      tag_ids: tagIds?.length ? tagIds : [], exam_ids: examIds?.length ? examIds : [],
      source, quality, points_earned: pts,
    };
    if (typeof startTime === "string" && START_TIME_RE.test(startTime)) rec.start_time = startTime;
    this.records.push(rec);
    this.saveRecords();
    this._addPoints(pts, `勉強記録 ${dateStr} (${minutes}分)`);
    this._checkStreakMilestone();
    this._applyDecayForPastRecord(dateStr);
    this._checkGoals(dateStr);
    this._refundSaboriIfNeeded(dateStr);
    return rec;
  }

  // タイトル(content)はいつでも編集可。tag_ids / exam_ids は記録した当日のみ。 → [ok, エラー文 or null]
  updateRecord(recId, patch) {
    const r = this.records.find((x) => x.id === recId);
    if (!r) return [false, "記録が見つかりません"];
    const locked = r.date !== todayIso();
    if ("content" in patch) r.content = patch.content;
    if (!locked) {
      if ("tag_ids" in patch) r.tag_ids = patch.tag_ids;
      if ("exam_ids" in patch) r.exam_ids = patch.exam_ids;
    } else if ("tag_ids" in patch || "exam_ids" in patch) {
      this.saveRecords();
      return [false, "タグ・試験の紐づけは記録した当日のみ編集できます"];
    }
    this.saveRecords();
    return [true, null];
  }

  deleteRecord(recId) {
    const t = this.records.find((r) => r.id === recId);
    if (!t) return false;
    const pts = t.points_earned ?? 0;
    this.records = this.records.filter((r) => r.id !== recId);
    this.saveRecords();
    if (pts > 0) this._addPoints(-pts, `🗑 記録削除 ${t.date} (${t.minutes}分)`);
    return true;
  }

  _addPoints(amount, reason) {
    this.points.balance = pyRound(this.points.balance + amount, 2);
    this.points.history.push({ ts: nowIsoSeconds(), delta: amount, reason, balance: this.points.balance });
    this.savePoints();
  }

  spendPoints(amount, reason) {
    if (this.points.balance < amount) return false;
    this._addPoints(-amount, reason);
    return true;
  }

  // ── ストリーク(連続記録) ──
  // 日付はすべて ISO 文字列("YYYY-MM-DD")で扱う。さぼり券を使った日も、連続の継続として数える。
  streakInfo() {
    const dateSet = new Set(this.records.map((r) => r.date));
    const saboriSet = new Set(this.store.get(F.sabori, () => []));
    const today = todayIso();
    const yesterday = addDaysIso(today, -1);
    const effective = (iso) => dateSet.has(iso) || saboriSet.has(iso);
    const countFrom = (start) => {
      let streak = 0, cur = start;
      while (effective(cur)) { streak++; cur = addDaysIso(cur, -1); }
      return streak;
    };
    if (effective(today)) return [countFrom(today), "active"];
    if (effective(yesterday)) return [countFrom(yesterday), "warning"];
    return [countFrom(today), "danger"];
  }

  // 現在進行中の連続記録に含まれる日付の集合と、日数・状態を返す → [Set, 日数, 状態]
  _currentStreakDates() {
    const [streak, state] = this.streakInfo();
    let dates = new Set();
    if (streak > 0) {
      const end = state === "active" ? todayIso() : addDaysIso(todayIso(), -1);
      dates = new Set(Array.from({ length: streak }, (_, i) => addDaysIso(end, -i)));
    }
    return [dates, streak, state];
  }

  // 過去に続いていた連続記録も含めて、連続している日付のかたまり(さぼり券の日も連続として数える)を古い順に返す。
  // 各要素: {start, end, days, current}。進行中のものは日数に関わらず含め、過去のものは minDays 日以上だけ返す。
  streakRuns(minDays = 2) {
    const today = todayIso();
    const all = new Set([...this.records.map((r) => r.date), ...this.store.get(F.sabori, () => [])]);
    const effective = [...all].sort().filter((x) => x <= today);
    const [, curCount, curState] = this._currentStreakDates();
    const curEnd = curCount > 0 ? (curState === "active" ? today : addDaysIso(today, -1)) : null;
    const runs = [];
    let run = [];
    for (const x of [...effective, null]) {
      if (run.length && x !== null && daysBetween(run[run.length - 1], x) === 1) { run.push(x); continue; }
      if (run.length) {
        const start = run[0], end = run[run.length - 1];
        const isCur = end === curEnd;
        if (isCur || run.length >= minDays) runs.push({ start, end, days: run.length, current: isCur });
      }
      run = x !== null ? [x] : [];
    }
    return runs;
  }

  // 期間(firstIso〜lastIso)と重なる、過去の(いま進行中ではない)連続記録。カレンダー・統計の表示用。新しい順。
  pastStreaksBetween(firstIso, lastIso) {
    const out = this.streakRuns().filter((r) => !r.current && r.end >= firstIso && r.start <= lastIso);
    return out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  }

  // streak_bonus_days ごとに繰り返しボーナス(7,14,21...)。連続が途切れたあと、また N 日連続したら再び付与される。
  // 二重付与を防ぐ印は「N日 + その連続期間の開始日」(例: streak_7@2026-09-10)。
  _checkStreakMilestone() {
    const [streak] = this.streakInfo();
    const step = pyGet(this.settings, "streak_bonus_days", 7);
    const bonus = pyGet(this.settings, "streak_bonus_points", 30);
    if (step <= 0 || streak <= 0 || streak % step !== 0) return 0;
    const [dates] = this._currentStreakDates();
    const achieved = new Set(this.store.get(F.milestones, () => []));
    const key = `streak_${streak}@${[...dates].sort()[0]}`;
    if (achieved.has(key)) return 0;
    achieved.add(key);
    this.store.save(F.milestones, [...achieved]);
    this._addPoints(bonus, `🎉 連続${streak}日達成ボーナス`);
    return bonus;
  }

  // ── さぼり券(所持制・自動適用) ──
  saboriOwned() { return this._jload(F.saboriOwned, () => ({ owned: 0 })).owned; }

  // → [ok, エラー文 or null]
  buySaboriTicket() {
    const ownedData = this._jload(F.saboriOwned, () => ({ owned: 0 }));
    const maxOwned = pyGet(this.settings, "sabori_max_owned", 2);
    if (ownedData.owned >= maxOwned) return [false, `すでに上限(${maxOwned}枚)です`];
    const price = pyGet(this.settings, "sabori_price", 500);
    if (!this.spendPoints(price, "🛍 さぼり券購入")) return [false, "ポイントが不足しています"];
    ownedData.owned += 1;
    this.store.save(F.saboriOwned, ownedData);
    return [true, null];
  }

  // 起動時に1回呼ぶ。「勉強も起動もなかった日」が直近で続いている分だけ、所持しているさぼり券を新しい日から順に
  // 自動消費してストリークを保護する。ここだけがさぼり券を消費する唯一の経路。ポイント消失の判定には影響しない。
  autoApplySabori() {
    let launchLog = new Set(this._jload(F.launchLog, () => []));
    const dateSet = new Set(this.records.map((r) => r.date));
    const saboriLog = new Set(this._jload(F.sabori, () => []));
    const ownedData = this._jload(F.saboriOwned, () => ({ owned: 0 }));

    const today = todayIso();
    const gaps = [];
    if (ownedData.owned > 0) {
      let d = addDaysIso(today, -1);
      for (let i = 0; i < 30; i++) {            // 直近30日まで遡って確認すれば十分
        if (dateSet.has(d) || saboriLog.has(d)) break;   // 既にカバー済みの日に達したら、それより前は無関係
        if (launchLog.has(d)) break;                      // 起動だけはしていた日は対象外
        gaps.push(d);
        d = addDaysIso(d, -1);
      }
    }
    const applied = [];
    for (const iso of gaps) {
      if (ownedData.owned <= 0) break;
      saboriLog.add(iso);
      ownedData.owned -= 1;
      applied.push(iso);
    }
    if (applied.length) {
      this.store.save(F.sabori, [...saboriLog].sort());
      this.store.save(F.saboriOwned, ownedData);
    }
    // 今日の起動を記録(直近60日だけ保持)
    launchLog.add(today);
    const cutoff = addDaysIso(today, -60);
    launchLog = new Set([...launchLog].filter((d) => d >= cutoff));
    this.store.save(F.launchLog, [...launchLog].sort());
    return applied;
  }

  // さぼり券を自動適用した日に、後から記録を追加した場合の払い戻し。
  _refundSaboriIfNeeded(dateStr) {
    const saboriLog = new Set(this._jload(F.sabori, () => []));
    if (!saboriLog.has(dateStr)) return;
    saboriLog.delete(dateStr);
    this.store.save(F.sabori, [...saboriLog].sort());
    const ownedData = this._jload(F.saboriOwned, () => ({ owned: 0 }));
    const maxOwned = pyGet(this.settings, "sabori_max_owned", 2);
    ownedData.owned = Math.min(maxOwned, ownedData.owned + 1);
    this.store.save(F.saboriOwned, ownedData);
  }

  // ── ポイントの消失(decay) ──
  // 重要: さぼり券・アプリ起動の有無に関係なく、「実際に学習した最後の日」からの空白日数だけで判定する。
  applyDecay() {
    const today = todayIso();
    const decayLog = this._jload(F.decay, () => ({ last_applied: "" }));
    if (pyGet(decayLog, "last_applied", null) === today) return;

    const dateSet = new Set(this.records.map((r) => r.date));
    if (!dateSet.size) {
      decayLog.last_applied = today;
      this.store.save(F.decay, decayLog);
      return;
    }
    const last = [...dateSet].sort().at(-1);
    parseIso(last);
    const gap = daysBetween(last, today);
    const rate = this.settings.decay_rate;
    const decayDays = this.settings.decay_days;

    if (gap > decayDays) {
      const lastApplied = pyGet(decayLog, "last_applied", "");
      const penaltyDays = lastApplied ? daysBetween(lastApplied, today) : gap - decayDays;
      for (let i = 0; i < Math.max(0, penaltyDays); i++) {
        const decay = pyRound(this.points.balance * rate, 2);
        if (decay > 0) this._addPoints(-decay, `⚠️ サボりペナルティ (-${fmt0f(rate * 100)}%/日)`);
      }
    }
    decayLog.last_applied = today;
    this.store.save(F.decay, decayLog);
  }

  // 過去日付の記録を追加した際、その日付より前の空白期間のペナルティを適用する(実際の学習記録のみを見る)。
  _applyDecayForPastRecord(dateStr) {
    parseIso(dateStr);
    if (dateStr >= todayIso()) return;
    const effectivePrev = new Set(this.records.filter((r) => r.date < dateStr).map((r) => r.date));
    if (!effectivePrev.size) return;
    const lastPrev = [...effectivePrev].sort().at(-1);
    const gap = daysBetween(lastPrev, dateStr);
    const decayDays = this.settings.decay_days;
    const rate = this.settings.decay_rate;
    if (gap > decayDays) {
      const penaltyN = gap - decayDays;
      for (let i = 0; i < penaltyN; i++) {
        const decay = pyRound(this.points.balance * rate, 2);
        if (decay > 0) this._addPoints(-decay, `⚠️ サボりペナルティ(過去記録分) (-${fmt0f(rate * 100)}%/日)`);
      }
    }
  }

  // ── 目標(月間・試験) ──
  _checkGoals(dateStr) {
    const ym = dateStr.slice(0, 7);
    const monthly = pyGet(this.settings, "monthly_goal_min", null);
    if (monthly && !this.settings[`monthly_achieved_${ym}`]) {
      const total = this.records.filter((r) => r.date.startsWith(ym)).reduce((a, r) => a + r.minutes, 0);
      if (total >= monthly) {
        this.settings[`monthly_achieved_${ym}`] = true;
        this.saveSettings();
        this._addPoints(this.settings.monthly_goal_bonus, `🏆 ${ym} 月次目標達成ボーナス`);
      }
    }
    for (const exam of this.exams) {
      if (exam.goal_achieved) continue;
      const gm = pyGet(exam, "goal_minutes", 0);
      if (!gm) continue;
      const [done] = this.examProgress(exam);
      if (done >= gm) {
        exam.goal_achieved = true;
        this.saveExams();
        const bonus = pyGet(exam, "goal_bonus_points", pyGet(this.settings, "exam_goal_bonus", 70));
        this._addPoints(bonus, `🏆 ${exam.name} 目標達成ボーナス`);
      }
    }
  }

  // その記録に明示的に紐づけられているかで判定。試験日より後の記録は、試験自体には計上しない(水増し防止)。
  // → [done, goal, ratio](目標を超えても100%で頭打ちにせず、実際の比率を返す)
  examProgress(exam) {
    const gm = pyGet(exam, "goal_minutes", 0);
    const done = this.records
      .filter((r) => (r.exam_ids || []).includes(exam.id) && r.date <= exam.date)
      .reduce((a, r) => a + r.minutes, 0);
    return [done, gm, gm ? done / gm : 0.0];
  }

  upcomingExams() {
    const t = todayIso();
    return this.exams.filter((e) => e.date >= t).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // ── 試験・報酬・タグの CRUD ──
  addExam(name, dateStr, goalMinutes, goalBonusPoints = null) {
    const exam = {
      id: this.nextExamId(), name, date: dateStr, created_date: todayIso(), goal_minutes: goalMinutes,
      goal_bonus_points: goalBonusPoints || pyGet(this.settings, "exam_goal_bonus", 70),
      goal_achieved: false,
    };
    this.exams.push(exam);
    this.saveExams();
    return exam;
  }

  updateExam(examId, name, dateStr, goalMinutes) {
    const e = this.examById(examId);
    if (!e) return false;
    e.name = name; e.date = dateStr; e.goal_minutes = goalMinutes;
    this.saveExams();
    return true;
  }

  deleteExam(examId) {
    this.exams = this.exams.filter((e) => e.id !== examId);
    this.saveExams();
    // 削除された試験への紐づけも記録側から外す
    for (const r of this.records) if ((r.exam_ids || []).includes(examId)) removeFirst(r.exam_ids, examId);
    this.saveRecords();
  }

  // ── ショップ(報酬) ──
  // 報酬の名前・必要ポイントの入力チェック → [名前, 必要ポイント, エラー文言]
  // (Python 版との違い: 必要ポイントが無限大のときも、例外ではなく「数字で入力してください」にする)
  static _cleanRewardInput(name, cost) {
    name = pyStrip(name || "");
    if (!name) return [null, null, "名称を入力してください"];
    if ([...name].length > 40) return [null, null, "名称は40文字までです"];
    let c;
    try {
      const f = toPyFloat(cost);
      if (!Number.isFinite(f)) throw new Error("not finite");
      c = pyRound(f);
    } catch { return [null, null, "必要ポイントは数字で入力してください"]; }
    if (!(c >= 1 && c <= 10_000_000)) return [null, null, "必要ポイントは1以上の数字で入力してください"];
    return [name, c, null];
  }

  addReward(name, cost, favorite = false, goal = false) {
    const [n, c, err] = DataManager._cleanRewardInput(name, cost);
    if (err) return [null, err];
    const reward = { id: this.nextRewardId(), name: n, cost: c, favorite: pyBool(favorite), goal: pyBool(goal) };
    this.rewards.push(reward);
    this.saveRewards();
    return [reward, null];
  }

  updateReward(rewardId, name, cost) {
    const reward = this.rewards.find((r) => r.id === rewardId);
    if (!reward) return [null, "見つかりません"];
    const [n, c, err] = DataManager._cleanRewardInput(name, cost);
    if (err) return [null, err];
    reward.name = n; reward.cost = c;
    this.saveRewards();
    return [reward, null];
  }

  // お気に入り(★)・目標(🎯)の切り替え。null の項目は変えない。
  setRewardFlag(rewardId, favorite = null, goal = null) {
    const reward = this.rewards.find((r) => r.id === rewardId);
    if (!reward) return false;
    if (favorite != null) reward.favorite = pyBool(favorite);
    if (goal != null) reward.goal = pyBool(goal);
    this.saveRewards();
    return true;
  }

  deleteReward(rewardId) {
    this.rewards = this.rewards.filter((r) => r.id !== rewardId);
    this.saveRewards();
  }

  // 「交換できる報酬」の表示順: 目標を除き、お気に入りを先頭に固定(それ以外は保存順)。
  _shopGridRewards() {
    return this.rewards.filter((r) => !r.goal).sort((a, b) => (a.favorite ? 0 : 1) - (b.favorite ? 0 : 1));
  }

  // 「交換できる報酬」の並び順を保存する(目標を除く・お気に入りが先頭の並びのID)。
  // 目標の報酬は元の位置のまま。 → [成功したか, エラー文言]
  setRewardOrder(orderedIds) {
    const nonGoal = this.rewards.filter((r) => !r.goal);
    const byId = new Map(nonGoal.map((r) => [r.id, r]));
    if (!Array.isArray(orderedIds) || orderedIds.length !== byId.size
        || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((i) => byId.has(i))) {
      return [false, "並び順が正しくありません"];
    }
    const flags = orderedIds.map((i) => pyBool(byId.get(i).favorite));
    if (flags.some((f, i) => i > 0 && !flags[i - 1] && f)) return [false, "お気に入りは先頭に固定されています"];
    const it = orderedIds.map((i) => byId.get(i))[Symbol.iterator]();
    this.rewards = this.rewards.map((r) => (r.goal ? r : it.next().value));
    this.saveRewards();
    return [true, null];
  }

  buyReward(rewardId, qty = 1) {
    const reward = this.rewards.find((r) => r.id === rewardId);
    if (!reward) return [false, "見つかりません"];
    let q;
    try { q = pyInt(qty); } catch { return [false, "数量が正しくありません"]; }
    if (q < 1) return [false, "数量が正しくありません"];
    // 履歴には「名前 ×数量」で残す(ショップの購入履歴の表示用)
    if (!this.spendPoints(reward.cost * q, `🛍 ${reward.name} ×${q}`)) return [false, "ポイントが不足しています"];
    return [true, null];
  }

  // 報酬フォームの「参考: ポイント換算グラフ」用。現在の換算式で、学習時間→獲得ポイントの曲線、
  // 必要ポイントに届くまでの連続学習時間(増加関数とみなして二分探索)、runHours 時間の学習が何回分で届くか を返す。
  rewardCostReference(cost, runHours = 2) {
    const formula = pyGet(this.settings, "point_formula", null);
    const pts = (hours) => calcBasePoints(hours * 60, formula);
    let needed = null;
    if (cost > 0) {
      let hi = 1.0;
      while (pts(hi) < cost && hi < 10000) hi *= 2;
      if (pts(hi) >= cost) {
        let lo = 0.0;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (pts(mid) < cost) lo = mid; else hi = mid;
        }
        needed = hi;
      }
    }
    const maxHour = needed !== null ? Math.max(6, Math.ceil(needed) + 1) : 6;
    const hours = Array.from({ length: 11 }, (_, i) => maxHour * i / 10);
    const perRun = pts(runHours);
    return {
      hours,
      vals: hours.map((h) => pyRound(pts(h), 2)),
      needed_hours: needed,
      run_hours: runHours,
      per_run_points: perRun,
      runs: cost > 0 && perRun > 0 ? cost / perRun : null,
    };
  }

  addTag(name, color) {
    const tag = { id: this.nextTagId(), name, color };
    this.tags.push(tag);
    this.saveTags();
    return tag;
  }

  updateTag(tagId, name, color) {
    const t = this.tagById(tagId);
    if (!t) return false;
    t.name = name; t.color = color;
    this.saveTags();
    return true;
  }

  deleteTag(tagId) {
    this.tags = this.tags.filter((t) => t.id !== tagId);
    this.saveTags();
    for (const r of this.records) if ((r.tag_ids || []).includes(tagId)) removeFirst(r.tag_ids, tagId);
    this.saveRecords();
  }

  reorderTags(orderedIds) {
    const byId = new Map(this.tags.map((t) => [t.id, t]));
    this.tags = orderedIds.filter((i) => byId.has(i)).map((i) => byId.get(i));
    this.saveTags();
  }

  // ── 統計(単純なもの) ──
  statsToday() {
    const t = todayIso();
    return this.records.filter((r) => r.date === t).reduce((a, r) => a + r.minutes, 0);
  }

  statsMonth(ym = null) {
    if (ym === null) ym = todayIso().slice(0, 7);
    return this.records.filter((r) => r.date.startsWith(ym)).reduce((a, r) => a + r.minutes, 0);
  }

  statsByDate() {
    const d = {};
    for (const r of this.records) d[r.date] = (d[r.date] ?? 0) + r.minutes;
    return d;
  }

  tagSummaryAll() {
    const d = {};
    for (const r of this.records) for (const tid of (r.tag_ids || [])) d[tid] = (d[tid] ?? 0) + r.minutes;
    return d;
  }

  // ── ショップの表示用データ ──
  shopHistory() { return this.points.history.filter((h) => pyGet(h, "reason", "").includes("🛍")); }

  // 購入履歴の1件から、表示用の [名前, 数量] を取り出す。「🛍 名前 ×2」と、数量表記の無い古い履歴「🛍 名前」の両方を読める。
  static _parseShopEntry(h) {
    const reason = pyGet(h, "reason", "");
    if (reason === "🛍 さぼり券購入") return ["さぼり券", 1];
    const m = /^🛍 (.+?)(?: ×(\d+))?$/u.exec(reason);
    if (!m) return [pyStrip(reason.replaceAll("🛍", "")), 1];
    return [m[1], parseInt(m[2] || "1", 10)];
  }

  // ショップタブ用。並び順・購入できるか・目標の進み具合など、表示に必要な判定をここで済ませる。
  shopData() {
    const balance = this.points.balance;
    const view = (r) => {
      const cost = r.cost;
      return {
        id: r.id, name: r.name, cost,
        favorite: pyBool(r.favorite), goal: pyBool(r.goal),
        affordable: cost <= balance,
        progress_pct: cost > 0 ? Math.min(100, pyRound(balance / cost * 100)) : 100,
        max_qty: cost > 0 ? Math.trunc(floorDiv(balance, cost)) : 0,    // いまのポイントで買える最大数
      };
    };
    const goals = this.rewards.filter((r) => r.goal).map(view).sort((a, b) => b.cost - a.cost);   // 高い順
    const grid = this._shopGridRewards().map(view);

    const owned = this.saboriOwned();
    const maxOwned = pyGet(this.settings, "sabori_max_owned", 2);
    const price = pyGet(this.settings, "sabori_price", 500);
    const history = this.shopHistory().slice(-8).reverse().map((h) => {
      const [name, qty] = DataManager._parseShopEntry(h);
      return { ts: h.ts, date: h.ts.slice(0, 10), name, qty, delta: h.delta };
    });
    return {
      goals, grid,
      sabori: { owned, max: maxOwned, price, full: owned >= maxOwned, affordable: balance >= price },
      history,
      points_balance: balance,
    };
  }

  // 起動時にまとめて実行
  runStartupTasks() {
    this.autoApplySabori();
    this.applyDecay();
  }

  // ── カレンダー ──
  // 連続記録ボーナス(「🎉 連続N日達成ボーナス」)を、カレンダー上のどの日に印を付けるかを求める。
  // ボーナスは「連続期間ごとに」付与されるので、付与履歴の1件ずつについて、付与された日の日付が含まれる連続期間
  // (付与日がその期間の翌日=今日まだ記録していない場合も含む)を探し、その期間の「N日目」に付ける。
  // → { "YYYY-MM-DD": [{streak: N, points: P}, ...] }(ポイント履歴と現在の記録から導くだけ。表示用)
  _streakMilestoneDays() {
    const grants = [];   // [付与日, N, 付与されたポイント]
    for (const h of this.points.history) {
      const m = /^🎉 連続(\d+)日達成ボーナス/u.exec(pyGet(h, "reason", ""));
      if (m && h.ts) {
        const g = h.ts.slice(0, 10);
        parseIso(g);
        grants.push([g, parseInt(m[1], 10), pyGet(h, "delta", 0)]);
      }
    }
    if (!grants.length) return {};

    const effective = [...new Set([...this.records.map((r) => r.date), ...this._jload(F.sabori, () => [])])].sort();
    const runs = [];     // 連続している日付のかたまり(さぼり券の日も連続として数える)
    let prev = null;
    for (const iso of effective) {
      if (prev !== null && daysBetween(prev, iso) === 1) runs[runs.length - 1].push(iso);
      else runs.push([iso]);
      prev = iso;
    }
    const out = {};
    for (const [grantedOn, n, pts] of grants) {
      for (const run of runs) {
        if (run[0] <= grantedOn && grantedOn <= addDaysIso(run[run.length - 1], 1)) {
          if (n <= run.length) (out[run[n - 1]] ??= []).push({ streak: n, points: pts });
          break;
        }
      }
    }
    return out;
  }

  // カレンダータブ用に、表示する月(と、その前後の週の端の日)のデータをまとめて返す。
  // weekStart: 0 = 日曜始まり, 1 = 月曜始まり。
  calendarMonth(year, month, weekStart = 0) {
    const today = todayIso();
    const first = `${pad(year, 4)}-${pad(month, 2)}-01`;
    parseIso(first);                                   // 存在しない月はここで例外
    const nDays = daysInMonth(year, month);
    const last = `${pad(year, 4)}-${pad(month, 2)}-${pad(nDays, 2)}`;

    // 月の1日/末日を含む週の端まで広げた、表示グリッドの範囲
    const sun0 = (iso) => (weekdayMon0(iso) + 1) % 7;    // 日=0 … 土=6
    const gridStart = addDaysIso(first, -floorMod(sun0(first) - weekStart, 7));
    const gridEnd = addDaysIso(last, floorMod(weekStart + 6 - sun0(last), 7));

    const byDate = new Map();
    for (const r of this.records) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
    const sabori = new Set(this._jload(F.sabori, () => []));
    const examsByDate = new Map();
    for (const e of this.exams) {
      if (!examsByDate.has(e.date)) examsByDate.set(e.date, []);
      examsByDate.get(e.date).push({ id: e.id, name: e.name });
    }
    const milestones = this._streakMilestoneDays();

    const [streakDates, streak, state] = this._currentStreakDates();   // 現在進行中の連続記録に含まれる日
    const pastDates = new Set();                                       // 過去に続いていた連続記録の日
    for (const r of this.streakRuns().filter((x) => !x.current)) {
      const n = daysBetween(r.start, r.end) + 1;
      for (let i = 0; i < n; i++) pastDates.add(addDaysIso(r.start, i));
    }

    const days = {};
    for (let d = gridStart; d <= gridEnd; d = addDaysIso(d, 1)) {
      const recs = byDate.get(d) ?? [];
      const entry = {
        minutes: sum(recs.map((r) => r.minutes)),
        points: pyRound(sum(recs.map((r) => pyGet(r, "points_earned", 0))), 2),
        records: recs,
        sabori: sabori.has(d),
        exams: examsByDate.get(d) ?? [],
        milestones: milestones[d] ?? [],
        in_streak: streakDates.has(d),
        in_past_streak: pastDates.has(d) && !streakDates.has(d),
      };
      if (recs.length || entry.sabori || entry.exams.length || entry.milestones.length || entry.in_streak || entry.in_past_streak) days[d] = entry;
    }

    const ym = `${pad(year, 4)}-${pad(month, 2)}`;
    const monthRecs = this.records.filter((r) => r.date.startsWith(ym));
    let elapsed;
    if (first > today) elapsed = 0;                  // 未来の月
    else if (last < today) elapsed = nDays;          // 過去の月
    else elapsed = parseInt(today.slice(8), 10);     // 今月は今日まで
    const goalMin = pyGet(this.settings, "monthly_goal_min", 3000);

    return {
      year, month, week_start: weekStart,
      grid_start: gridStart, grid_end: gridEnd,
      days,
      summary: {
        total_min: sum(monthRecs.map((r) => r.minutes)),
        studied_days: new Set(monthRecs.map((r) => r.date)).size,
        elapsed_days: elapsed,
        points: pyRound(sum(monthRecs.map((r) => pyGet(r, "points_earned", 0))), 2),
      },
      goal: { goal_min: goalMin },
      streak: {
        count: streak, state,
        sabori_dates: [...streakDates].filter((x) => sabori.has(x)).sort(),
        past: this.pastStreaksBetween(gridStart, gridEnd),
      },
      tags: this.tags,
      exams: this.exams.map((e) => ({ id: e.id, name: e.name, date: e.date })),
      points_balance: this.points.balance,
    };
  }

  // ── 統計タブ ──
  static _summarize(recs) {
    const qs = recs.filter((r) => pyGet(r, "quality", null)).map((r) => r.quality);
    return {
      total_min: sum(recs.map((r) => r.minutes)),
      points: pyRound(sum(recs.map((r) => pyGet(r, "points_earned", 0))), 2),
      count: recs.length,
      avg_quality: qs.length ? sum(qs) / qs.length : null,
      studied_days: new Set(recs.map((r) => r.date)).size,
    };
  }

  // [[key, 分], ...] → [{key, minutes, ratio, pct}]。pct は合計がちょうど100になるよう最大剰余法で丸める。
  static _ratios(pairs) {
    const total = sum(pairs.map(([, m]) => m));
    if (total <= 0) return pairs.map(([k, m]) => ({ key: k, minutes: m, ratio: 0.0, pct: 0 }));
    const raw = pairs.map(([, m]) => m * 100 / total);
    const floors = raw.map((x) => Math.trunc(x));
    const order = raw.map((_, i) => i).sort((i, j) => (raw[j] - floors[j]) - (raw[i] - floors[i]));   // 安定ソート(同じ値は元の順)
    for (const i of order.slice(0, 100 - sum(floors))) floors[i] += 1;
    return pairs.map(([k, m], i) => ({ key: k, minutes: m, ratio: raw[i] / 100, pct: floors[i] }));
  }

  // 開始時刻から時間帯を決める: 午前 0:00-11:59 / 午後 12:00-17:59 / 夜 18:00-23:59。
  static _slotOf(startTime) {
    let h;
    try { h = pyInt(String(startTime).split(":")[0]); } catch { return null; }
    if (!(h >= 0 && h <= 23)) return null;
    return h < 12 ? "morning" : h < 18 ? "afternoon" : "night";
  }

  // 統計タブ用。period は "week"(今週・月曜〜日曜) / "month"(今月) / "all"(全期間)。
  // 前期間との比較は、日数をそろえた「ここまで」同士で行う。
  statsPeriod(period) {
    const today = todayIso();
    const recsAll = this.records;
    let prevStart = null, prevEnd = null, end = null, start, compareLabel;
    if (period === "week") {
      start = addDaysIso(today, -weekdayMon0(today));
      end = addDaysIso(start, 6);
      prevStart = addDaysIso(start, -7);
      prevEnd = addDaysIso(prevStart, daysBetween(start, today));
      compareLabel = "先週比";
    } else if (period === "month") {
      start = today.slice(0, 8) + "01";
      end = `${today.slice(0, 8)}${pad(daysInMonth(+today.slice(0, 4), +today.slice(5, 7)), 2)}`;
      const prevLast = addDaysIso(start, -1);
      prevStart = prevLast.slice(0, 8) + "01";
      prevEnd = addDaysIso(prevStart, Math.min(parseInt(today.slice(8), 10), parseInt(prevLast.slice(8), 10)) - 1);
      compareLabel = "先月比";
    } else {
      period = "all";
      compareLabel = null;
      const dates = recsAll.map((r) => r.date);
      const earliest = dates.length ? [...dates].sort()[0] : null;
      if (earliest !== null) parseIso(earliest);
      start = earliest !== null ? (earliest < today ? earliest : today) : today;
    }

    const upper = end ?? "9999-12-31";
    const recs = recsAll.filter((r) => start <= r.date && r.date <= upper);
    const cur = DataManager._summarize(recs);

    let compare = null;
    if (prevStart) {
      const prev = DataManager._summarize(recsAll.filter((r) => prevStart <= r.date && r.date <= prevEnd));
      const pct = (c, p) => (p ? pyRound((c - p) / p * 100) : null);   // 比較元が0なら割合は出さない
      const qDiff = cur.avg_quality !== null && prev.avg_quality !== null ? pyRound(cur.avg_quality - prev.avg_quality, 2) : null;
      compare = {
        label: compareLabel,
        total_min_pct: pct(cur.total_min, prev.total_min),
        points_pct: pct(cur.points, prev.points),
        count_pct: pct(cur.count, prev.count),
        quality_diff: qDiff,
      };
    }

    const byDate = {};
    for (const r of recs) byDate[r.date] = (byDate[r.date] ?? 0) + r.minutes;
    const sabori = new Set(this._jload(F.sabori, () => []));
    const [streakDates, streak, state] = this._currentStreakDates();
    const saboriInStreak = [...streakDates].filter((x) => sabori.has(x)).sort();

    // ── 期間ごとのメインのグラフ用データ ──
    const panel = { kind: period };
    if (period === "week") {
      const rows = [];
      for (let i = 0; i < 7; i++) {
        const di = addDaysIso(start, i);
        const dayRecs = recs.filter((r) => r.date === di);
        rows.push({
          date: di, weekday: WEEKDAYS[i], minutes: byDate[di] ?? 0,
          is_today: di === today, is_future: di > today,
          sabori: sabori.has(di) && !byDate[di],
          tag_ids: [...new Set(dayRecs.flatMap((r) => r.tag_ids || []))].sort((a, b) => a - b),
        });
      }
      const past = rows.filter((r) => !r.is_future);
      panel.rows = rows;
      panel.missing_dates = past.filter((r) => !r.minutes && !r.sabori && !r.is_today).map((r) => r.date);
      panel.sabori_dates = past.filter((r) => r.sabori).map((r) => r.date);
      panel.elapsed_days = past.length;
    } else if (period === "month") {
      const n = daysBetween(start, end) + 1;
      const days = [];
      for (let i = 0; i < n; i++) {
        const di = addDaysIso(start, i);
        days.push({ day: i + 1, date: di, minutes: byDate[di] ?? 0, sabori: sabori.has(di) && !byDate[di], is_today: di === today, is_future: di > today });
      }
      panel.days = days;
      panel.month = parseInt(start.slice(5, 7), 10);
      // この月に重なる連続記録(いま進行中のものと、過去のもの)を、月の中の日番号の範囲にして返す
      const spans = [];
      for (const r of this.streakRuns()) {
        if (r.end < start || r.start > end) continue;
        spans.push({
          from: parseInt((r.start > start ? r.start : start).slice(8), 10),
          to: parseInt((r.end < end ? r.end : end).slice(8), 10),
          days: r.days, current: r.current,
        });
      }
      panel.streak_spans = spans;
    } else {
      const byMonth = {};
      for (const r of recsAll) if (r.date <= today) byMonth[r.date.slice(0, 7)] = (byMonth[r.date.slice(0, 7)] ?? 0) + r.minutes;
      const months = [];
      let y = +start.slice(0, 4), m = +start.slice(5, 7);
      const ty = +today.slice(0, 4), tm = +today.slice(5, 7);
      while (y < ty || (y === ty && m <= tm)) {
        const ym = `${pad(y, 4)}-${pad(m, 2)}`;
        months.push({ ym, year: y, month: m, minutes: byMonth[ym] ?? 0, is_current: y === ty && m === tm });
        if (m === 12) { y += 1; m = 1; } else m += 1;
      }
      panel.truncated = months.length > 12;
      panel.months = months.slice(-12);
      // 最長連続記録(さぼり券の日も連続として数える。同じ長さなら新しい方)
      const eff = [...new Set([...recsAll.map((r) => r.date), ...sabori])].filter((x) => x <= today).sort();
      let best = null, run = [];
      for (const x of [...eff, null]) {
        if (run.length && x !== null && daysBetween(run[run.length - 1], x) === 1) { run.push(x); continue; }
        if (run.length && (best === null || run.length >= best.days)) best = { days: run.length, start: run[0], end: run[run.length - 1] };
        run = x !== null ? [x] : [];
      }
      panel.best_streak = best;
    }

    // ── 曜日別の平均(月曜始まり。記録のない日も0として平均に入れる) ──
    let weekdayAvg = null;
    if (period !== "week") {
      const occ = Array(7).fill(0);
      for (let d = start; d <= today; d = addDaysIso(d, 1)) occ[weekdayMon0(d)] += 1;
      const mins = Array(7).fill(0);
      for (const r of recs) if (r.date <= today) mins[weekdayMon0(r.date)] += r.minutes;
      weekdayAvg = Array.from({ length: 7 }, (_, i) => ({ weekday: WEEKDAYS[i], avg_min: occ[i] ? mins[i] / occ[i] : 0.0 }));
    }

    // ── タグ別(複数タグの記録は各タグに全時間を数える。ホームと同じ。タグ無しの記録は含めない) ──
    const tagMin = {};
    for (const r of recs) for (const tid of (r.tag_ids || [])) tagMin[tid] = (tagMin[tid] ?? 0) + r.minutes;
    const used = this.tags.filter((t) => tagMin[t.id]);
    const tagRatios = DataManager._ratios(used.map((t) => [t.id, tagMin[t.id]]));
    const tagsBreakdown = used.map((t, i) => ({ id: t.id, name: t.name, color: t.color, minutes: tagRatios[i].minutes, ratio: tagRatios[i].ratio, pct: tagRatios[i].pct }));

    const qualityDist = [5, 4, 3, 2, 1].map((s_) => ({ star: s_, count: recs.filter((r) => pyGet(r, "quality", null) === s_).length }));

    // ── 詳細統計 ──
    const studied = cur.studied_days;
    let maxDay = null;
    for (const [k, v] of Object.entries(byDate)) if (maxDay === null || v > maxDay[1] || (v === maxDay[1] && k > maxDay[0])) maxDay = [k, v];
    const timed = recs.filter((r) => DataManager._slotOf(pyGet(r, "start_time", null)) !== null);
    const slotMin = { morning: 0, afternoon: 0, night: 0 };
    for (const r of timed) slotMin[DataManager._slotOf(r.start_time)] += r.minutes;
    const wkMin = sum(Object.entries(byDate).filter(([k]) => weekdayMon0(k) < 5).map(([, v]) => v));
    const detail = {
      max_day: maxDay ? { minutes: maxDay[1], date: maxDay[0] } : null,
      avg_day_min: studied ? cur.total_min / studied : null,
      avg_per_record_min: cur.count ? cur.total_min / cur.count : null,
      records_per_day: studied ? cur.count / studied : null,
      time_slots: {
        items: DataManager._ratios(["morning", "afternoon", "night"].map((k) => [k, slotMin[k]])),
        timed_records: timed.length, total_records: cur.count,
      },
      weekday_split: DataManager._ratios([["weekday", wkMin], ["weekend", cur.total_min - wkMin]]),
      source_split: DataManager._ratios([
        ["stopwatch", sum(recs.filter((r) => pyGet(r, "source", null) === "stopwatch").map((r) => r.minutes))],
        ["manual", sum(recs.filter((r) => pyGet(r, "source", null) !== "stopwatch").map((r) => r.minutes))],
      ]),
    };

    const rangeEnd = end ?? today;
    return {
      period,
      range: { start, end: rangeEnd },
      overview: { ...cur, compare },
      streak: { count: streak, state, sabori_dates: saboriInStreak, past: this.pastStreaksBetween(start, rangeEnd) },
      panel,
      weekday_avg: weekdayAvg,
      tags_breakdown: tagsBreakdown,
      quality_dist: qualityDist,
      detail,
      tags: this.tags,
      points_balance: this.points.balance,
    };
  }

  // ── CSV ──
  // 書き出す内容(先頭に BOM つき = Excel でも文字化けしない)。Python 版の export_csv と同じ形式。
  exportCsvText() {
    let out = csvRow(["date", "minutes", "content", "tags", "exams", "source", "quality", "points_earned"]);
    for (const r of this.records) {
      const tn = (r.tag_ids || []).filter((tid) => this.tagById(tid)).map((tid) => this.tagById(tid).name).join(",");
      const en = (r.exam_ids || []).filter((eid) => this.examById(eid)).map((eid) => this.examById(eid).name).join(",");
      const pts = Object.prototype.hasOwnProperty.call(r, "points_earned") ? r.points_earned : 0;
      out += csvRow([r.date, r.minutes, pyGet(r, "content", ""), tn, en, pyGet(r, "source", ""), pyGet(r, "quality", "-"),
        typeof pts === "number" ? fmtPyFloat(pts) : pts]);
    }
    return "\ufeff" + out;
  }

  // ── CSV インポート(エクスポートと同じ形式の「記録」だけ) ──
  static IMPORT_MAX_ROWS = 50000;
  static IMPORT_TAG_COLORS = ["#4A90D9", "#E67E22", "#27AE60", "#8E44AD", "#E74C3C", "#7F8C8D", "#16A085", "#C0392B"];

  static _importRecordKey(dateStr, minutes, content, tagIds) {
    return JSON.stringify([dateStr, Math.trunc(minutes), pyStrip(content || ""), [...tagIds].sort((a, b) => a - b)]);
  }

  // export_csv が書き出した形式(date, minutes, content, tags, exams, source, quality, points_earned)の記録を取り込む。
  //  ・すでにある記録と同じ内容(日付・時間・内容・タグが一致)の行は取り込まない(再インポートしても重複しない)。
  //    同じ行が複数あるときは、すでにある数のぶんだけを重複とみなす。
  //  ・獲得ポイントは CSV の値を記録にだけ持たせる。ポイント残高・履歴・連続記録のボーナス・目標達成などは動かさない。
  //  ・タグは名前で結びつける。無い名前は新しいタグとして作る。試験は名前が一致する既存のものにだけ結びつける。
  //  ・形式が不正な行は取り込まずに、行番号と理由を返す。取り込む前の記録の控えは、ブラウザ内(meta)に残す。
  // (Python 版との違い: 無限大の数値・改行だけの区切りなど、Python 版では例外で止まる入力は、エラー/不正な行として扱う)
  importCsv(bytes) {
    let rows;
    try { rows = parseCsv(decodeCsvBytes(bytes)); }
    catch (e) { if (e instanceof CsvError) return { ok: false, error: `ファイルを読み込めませんでした: ${e.message}` }; throw e; }
    if (!rows.length) return { ok: false, error: "ファイルが空です" };
    const header = rows[0].map((h) => pyStrip(h).toLowerCase());
    const col = Object.create(null);
    header.forEach((name, i) => { if (name && !(name in col)) col[name] = i; });
    if (!("date" in col) || !("minutes" in col)) return { ok: false, error: "見出しの行に date と minutes の列が必要です(エクスポートしたCSVの形式です)" };
    const body = rows.slice(1);
    if (body.length > DataManager.IMPORT_MAX_ROWS) return { ok: false, error: `行数が多すぎます(${DataManager.IMPORT_MAX_ROWS}行まで)` };

    const cell = (r, name) => (name in col && col[name] < r.length ? pyStrip(r[col[name]]) : "");
    const today = todayIso();
    const tagIdsByName = new Map(this.tags.map((t) => [t.name, t.id]));
    const examIdsByName = new Map();
    for (const e of this.exams) if (!examIdsByName.has(e.name)) examIdsByName.set(e.name, e.id);
    const existing = new Map();
    for (const r of this.records) {
      const k = DataManager._importRecordKey(r.date, r.minutes, pyGet(r, "content", ""), r.tag_ids || []);
      existing.set(k, (existing.get(k) ?? 0) + 1);
    }

    const parsed = [], invalid = [], newTagNames = [];
    let unmatchedExams = 0;
    for (const [i, r] of body.entries()) {
      const n = i + 2;                                     // 行番号は見出しを1行目として数える
      if (!r.some((c) => pyStrip(c))) continue;              // 空行
      const dStr = cell(r, "date"), mStr = cell(r, "minutes");
      if (!isValidIso(dStr)) { invalid.push({ line: n, reason: `日付が正しくありません(${dStr || "空"})` }); continue; }
      if (dStr > today) { invalid.push({ line: n, reason: `未来の日付です(${dStr})` }); continue; }
      let minutes;
      try {
        const f = pyFloat(mStr);
        minutes = Math.trunc(f);
        if (!Number.isFinite(f) || minutes <= 0 || f !== minutes) throw new Error("bad");
      } catch { invalid.push({ line: n, reason: `時間(分)が正しくありません(${mStr || "空"})` }); continue; }
      let quality;
      try {
        const f = pyFloat(cell(r, "quality"));
        if (!Number.isFinite(f)) throw new Error("bad");
        quality = Math.trunc(f);
        if (!(quality >= 1 && quality <= 5)) quality = 3;
      } catch { quality = 3; }                              // 空・「-」などは標準の3
      let points;
      try {
        const f = pyFloat(cell(r, "points_earned"));
        points = Number.isFinite(f) ? pyRound(Math.max(0, f), 2) : 0.0;
      } catch { points = 0.0; }
      let source = cell(r, "source");
      if (source !== "stopwatch" && source !== "manual") source = "manual";
      const names = (key) => cell(r, key).split(",").map((x) => pyStrip(x)).filter((x) => x);
      parsed.push({ date: dStr, minutes, content: cell(r, "content"), quality, points, source, tagNames: names("tags"), examNames: names("exams") });
    }
    if (!parsed.length) return { ok: false, error: "取り込める行がありませんでした", invalid: invalid.slice(0, 20) };

    // タグ名 → id(無い名前は新規作成。作るのは、取り込む行が確定してから)
    for (const rec of parsed) for (const name of rec.tagNames) if (!tagIdsByName.has(name)) { tagIdsByName.set(name, null); newTagNames.push(name); }
    for (const name of newTagNames) {
      tagIdsByName.set(name, this.addTag(name, DataManager.IMPORT_TAG_COLORS[this.tags.length % DataManager.IMPORT_TAG_COLORS.length]).id);
    }

    // 控え(取り込む前の記録)。Python 版はファイルに書いていた。ブラウザ版は meta に残す(全データ削除で一緒に消える)。
    this.store.setMeta("records_before_import", { saved_at: nowIsoSeconds(), records: structuredClone(this.records) });

    let added = 0, duplicates = 0, nextId = this._nextRecId();
    for (const rec of parsed) {
      const tagIds = [...new Set(rec.tagNames)].map((nm) => tagIdsByName.get(nm));
      const key = DataManager._importRecordKey(rec.date, rec.minutes, rec.content, tagIds);
      if ((existing.get(key) ?? 0) > 0) { existing.set(key, existing.get(key) - 1); duplicates++; continue; }
      const examIds = [];
      for (const nm of new Set(rec.examNames)) { if (examIdsByName.has(nm)) examIds.push(examIdsByName.get(nm)); else unmatchedExams++; }
      this.records.push({
        id: nextId, date: rec.date, minutes: rec.minutes, content: rec.content, tag_ids: tagIds, exam_ids: examIds,
        source: rec.source, quality: rec.quality, points_earned: rec.points,
      });
      nextId++; added++;
    }
    if (added) this.saveRecords();
    return { ok: true, added, duplicates, invalid: invalid.slice(0, 20), invalid_count: invalid.length, new_tags: newTagNames, unmatched_exams: unmatchedExams };
  }

  // ── バックアップからの「記録だけ統合」 ──
  // files: 検証済みのバックアップの files。このバックアップにあって、いまのデータに無い「記録」だけを足す。
  //  ・同じ内容(日付・時間・内容・タグ名が一致)の記録は足さない。同じ記録が複数あるときは、いまある数のぶんだけを重複とみなす。
  //  ・タグは名前で結びつけ、無い名前は(足す記録が使うものだけ)色つきで作る。試験は「名前+日付」で結びつけ、無ければ
  //    (足す記録が使うものだけ)そのまま作る(目標達成ずみの印も引き継ぐので、ボーナスは二重に付かない)。
  //  ・ポイント残高・履歴・報酬・設定・さぼり券・連続記録のボーナスは、いまのまま(動かさない)。
  mergeRecordsFrom(files) {
    const srcRecords = files[F.records] ?? [];
    const srcTags = files[F.tags] ?? DEFAULT_TAGS;                     // ファイルが無ければ、既定のタグ
    const srcExams = files[F.exams] ?? [];
    const tagName = new Map(srcTags.map((t) => [t.id, t.name]));
    const srcTagById = new Map(srcTags.map((t) => [t.id, t]));
    const examById = new Map(srcExams.map((e) => [e.id, e]));
    const namesOf = (r) => [...new Set((r.tag_ids || []).filter((id) => tagName.has(id)).map((id) => tagName.get(id)))];
    const keyOf = (date, minutes, content, names) => JSON.stringify([date, Math.trunc(minutes), pyStrip(content || ""), [...names].sort()]);

    const existing = new Map();
    for (const r of this.records) {
      const k = keyOf(r.date, r.minutes, pyGet(r, "content", ""), (r.tag_ids || []).filter((id) => this.tagById(id)).map((id) => this.tagById(id).name));
      existing.set(k, (existing.get(k) ?? 0) + 1);
    }

    const toAdd = [];
    let duplicates = 0;
    for (const r of srcRecords) {
      const names = namesOf(r);
      const k = keyOf(r.date, r.minutes, pyGet(r, "content", ""), names);
      if ((existing.get(k) ?? 0) > 0) { existing.set(k, existing.get(k) - 1); duplicates++; continue; }
      toAdd.push({ r, names });
    }

    // 足す記録が使うタグ・試験を用意する
    const newTags = [], newExams = [];
    const tagIdByName = new Map(this.tags.map((t) => [t.name, t.id]));
    for (const { names } of toAdd) {
      for (const nm of names) {
        if (tagIdByName.has(nm)) continue;
        const src = srcTags.find((t) => t.name === nm);
        tagIdByName.set(nm, this.addTag(nm, pyGet(src, "color", "#7F8C8D")).id);
        newTags.push(nm);
      }
    }
    const examKey = (name, date) => JSON.stringify([name, date]);
    const examIdByKey = new Map(this.exams.map((e) => [examKey(e.name, e.date), e.id]));
    const mapExam = (srcId) => {
      const src = examById.get(srcId);
      if (!src) return null;
      const k = examKey(src.name, src.date);
      if (!examIdByKey.has(k)) {
        const copy = { ...structuredClone(src), id: this.nextExamId() };
        this.exams.push(copy);
        this.saveExams();
        examIdByKey.set(k, copy.id);
        newExams.push(src.name);
      }
      return examIdByKey.get(k);
    };

    let nextId = this._nextRecId();
    for (const { r, names } of toAdd) {
      const rec = {
        id: nextId++, date: r.date, minutes: r.minutes, content: pyGet(r, "content", ""),
        tag_ids: names.map((nm) => tagIdByName.get(nm)),
        exam_ids: [...new Set((r.exam_ids || []).map(mapExam).filter((id) => id !== null))],
        source: pyGet(r, "source", "manual"), quality: pyGet(r, "quality", 3), points_earned: pyGet(r, "points_earned", 0),
      };
      if (typeof r.start_time === "string") rec.start_time = r.start_time;
      this.records.push(rec);
    }
    if (toAdd.length) this.saveRecords();
    return { added: toAdd.length, duplicates, new_tags: newTags, new_exams: newExams };
  }

  // <<NEXT>>
}
