// 完全バックアップ(形式・検証・保存・復元・統合・元に戻す・リマインダー)。
// 特に、Python 版が実際に作ったデータ(照合用の台本の最終状態 = tools/export_desktop_data.py の出力)を、
// そのまま読み込んで復元できることを確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { openStorage } from "../ui/js/core/storage.js";
import { Api } from "../ui/js/core/localApi.js";
import { setClock, isValidIso } from "../ui/js/core/dates.js";
import {
  buildBackup, validateBackup, parseBackupText, summarizeFiles, isBackupDue, defaultBackupPrefs, daysSinceBackup,
  BACKUP_FORMAT, DESKTOP_BUNDLE_FORMAT, SCHEMA_VERSION,
} from "../ui/js/core/backup.js";
import { makeSame } from "./_same.js";

const enc = (s) => new TextEncoder().encode(s);
const parseNow = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); };
const sortMs = (files) => { const o = structuredClone(files); if (o["milestones_achieved.json"]) o["milestones_achieved.json"].sort(); return o; };

async function setup({ now = "2026-10-27T10:00:00", saveResult } = {}) {
  const idb = new IDBFactory();
  const store = await openStorage({ indexedDB: idb });
  const calls = { saved: [], reloads: 0 };
  const platform = {
    picked: null, saveResult: saveResult ?? { ok: true, filename: "b.json", method: "picker" }, picker: true,
    async saveFile(filename, text, mime) { calls.saved.push({ filename, text, mime }); return this.saveResult; },
    savePickerSupported() { return this.picker; },
    async pickFile() { return this.picked; },
    reload() { calls.reloads++; },
    async storageEstimate() { return null },
  };
  const restore = setClock(() => parseNow(now));
  const api = new Api(store, { platform });
  return { api, store, platform, calls, idb, restore, setNow: (n) => setClock(() => parseNow(n)) };
}
const file = (obj, name = "b.json") => ({ name, bytes: enc(typeof obj === "string" ? obj : JSON.stringify(obj)) });

// ── 実データ(Python 版が作った状態)の復元 ──
const scenarios = JSON.parse(gunzipSync(readFileSync(new URL("./golden/scenarios.json.gz", import.meta.url))).toString("utf8"));
for (const sc of scenarios.filter((s) => s.bundle)) {
  test(`デスクトップ版のバンドルを復元: ${sc.name}`, async () => {
    const last = sc.steps.at(-1).now;
    const final = sc.steps.at(-1).snapshot;
    const t = await setup({ now: last });
    try {
      const untouched = sortMs(t.store.exportAll());                  // (Api を作ると、起動時の処理でいくつかのファイルが保存される)
      t.platform.picked = file(sc.bundle, "study_tracker_desktop_data.json");
      const p = await t.api.pick_backup_file();

      // 日付として不正な記録を含むデータは、壊れたデータなので拒否する(Python 版の add_record は、日付の検証より先に保存してしまう。
      // 実際のデスクトップ版は画面で日付を検証するので、通常はこうなっていない)。何も変更されない。
      if (final["records.json"].some((r) => !isValidIso(r.date))) {
        assert.equal(p.ok, false);
        assert.ok(p.problems.some((m) => /日付が正しくありません/.test(m)));
        assert.deepEqual(sortMs(t.store.exportAll()), untouched);
        return;
      }

      assert.equal(p.ok, true, JSON.stringify(p));
      assert.equal(p.summary.format, "desktop");
      assert.equal(p.summary.incoming.records, final["records.json"].length);

      const r = await t.api.apply_backup("replace");
      assert.equal(r.ok, true);
      // 保存されたデータが、Python 版の最終状態と同じ
      const { same } = makeSame();
      same(sortMs(t.store.exportAll()), sortMs(final), "復元後のデータ");

      // 復元したデータで、すべての画面用 API が動く(例外にならない)。
      // (Api を作ると、起動時の処理が「今日の起動」を記録するなど、保存データが少し変わる)
      const api2 = new Api(t.store, { platform: t.platform });
      api2.get_home_data(); api2.get_shop(); api2.get_exams(); api2.get_records();
      for (const period of ["week", "month", "all"]) api2.get_stats(period);
      api2.get_calendar_month(2026, 10, 0); api2.get_calendar_month(2026, 6, 1);

      // Web 版のバックアップに書き出して読み直しても、同じ
      await api2.save_backup();
      const v = parseBackupText(t.calls.saved.at(-1).text);
      assert.equal(v.ok, true);
      same(sortMs(v.files), sortMs(t.store.exportAll()), "バックアップの往復");
    } finally { t.restore(); }
  });
}

// ── 検証 ──
const good = () => buildBackup({
  "records.json": [{ id: 1, date: "2026-10-20", minutes: 30, content: "x", tag_ids: [1], exam_ids: [], source: "manual", quality: 3, points_earned: 5.0 }],
  "points.json": { balance: 5, history: [{ ts: "2026-10-20T10:00:00", delta: 5, reason: "r", balance: 5 }] },
  "settings.json": { theme: "dark", pomodoro: { work: 30 } }, "tags.json": [{ id: 1, name: "数学", color: "#4A90D9" }],
}, "2026-10-27T10:00:00");

test("検証: 正しいバックアップは通る。知らないファイル名は無視して報告する", () => {
  const b = good();
  b.files["mystery.json"] = [1, 2, 3];
  const v = validateBackup(b);
  assert.equal(v.ok, true);
  assert.deepEqual(v.ignored, ["mystery.json"]);
  assert.equal(v.format, "backup");
  assert.equal(Object.keys(v.files).includes("mystery.json"), false);
  assert.equal(v.exportedAt, "2026-10-27T10:00:00");
});

test("検証: 形式・版・中身の問題は、何も取り込まずに拒否する", () => {
  const bad = (mutate, re) => {
    const b = good(); mutate(b);
    const v = validateBackup(b);
    assert.equal(v.ok, false, String(re));
    assert.match([v.error, ...v.problems].join("\n"), re);
  };
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([]).ok, false);
  assert.equal(validateBackup({ format: "other", files: {} }).ok, false);
  bad((b) => { b.schemaVersion = SCHEMA_VERSION + 1; }, /新しい版/);
  bad((b) => { b.schemaVersion = 0; }, /版が正しくありません/);
  bad((b) => { delete b.files; }, /中身/);
  bad((b) => { b.files = {}; }, /取り込めるデータ/);
  bad((b) => { b.files = { "other.json": [] }; }, /取り込めるデータ/);
  bad((b) => { b.files["records.json"][0].date = "2026-02-30"; }, /日付が正しくありません/);
  bad((b) => { b.files["records.json"][0].minutes = "30"; }, /時間/);
  bad((b) => { b.files["records.json"][0].minutes = -1; }, /時間/);
  bad((b) => { b.files["records.json"].push({ ...b.files["records.json"][0] }); }, /id が重複/);
  bad((b) => { b.files["records.json"][0].tag_ids = "1"; }, /tag_ids/);
  bad((b) => { b.files["records.json"][0].points_earned = null; }, /points_earned/);
  bad((b) => { b.files["records.json"] = {}; }, /配列ではありません/);
  bad((b) => { b.files["points.json"].balance = "5"; }, /balance/);
  bad((b) => { b.files["points.json"].history = [{}]; }, /履歴/);
  bad((b) => { b.files["settings.json"].pomodoro = []; }, /pomodoro/);
  bad((b) => { b.files["tags.json"] = [{ id: "1", name: "x" }]; }, /タグ/);
  bad((b) => { b.files["sabori_log.json"] = ["2026-13-01"]; }, /日付の配列/);
  bad((b) => { b.files["sabori_owned.json"] = { owned: -1 }; }, /owned/);
  bad((b) => { b.files["milestones_achieved.json"] = [1]; }, /文字列の配列/);
  bad((b) => { b.files["decay_log.json"] = { last_applied: 5 }; }, /last_applied/);
});

test("検証: 問題が多いときも、報告は数を絞る", () => {
  const b = good();
  b.files["records.json"] = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, date: "bad", minutes: 1 }));
  const v = validateBackup(b);
  assert.equal(v.ok, false);
  assert.ok(v.problems.length <= 8);
  assert.ok(v.problems.some((p) => /ほか \d+ 件/.test(p)));
});

test("検証: デスクトップ版バンドルの版・JSON として壊れたファイル", () => {
  assert.equal(validateBackup({ format: DESKTOP_BUNDLE_FORMAT, version: 2, files: { "records.json": [] } }).ok, false);
  assert.equal(validateBackup({ format: DESKTOP_BUNDLE_FORMAT, version: 1, files: { "records.json": [] } }).ok, true);
  const v = parseBackupText("{壊れた");
  assert.equal(v.ok, false); assert.match(v.error, /JSON/);
});

test("要約", () => {
  const s = summarizeFiles(good().files);
  assert.deepEqual(s, { records: 1, first_date: "2026-10-20", last_date: "2026-10-20", total_min: 30, points_balance: 5, tags: 1, exams: 0, rewards: 0 });
  assert.deepEqual(summarizeFiles({}), { records: 0, first_date: null, last_date: null, total_min: 0, points_balance: 0, tags: null, exams: 0, rewards: 0 });
});

// ── リマインダーの判定 ──
test("リマインダー: 周期・延期・記録なし・オフ", () => {
  const p = (o = {}) => ({ ...defaultBackupPrefs("2026-10-01"), ...o });
  assert.equal(isBackupDue(p(), "2026-10-07", 5), false);                       // 6日 < 7日
  assert.equal(isBackupDue(p(), "2026-10-08", 5), true);                        // 7日
  assert.equal(isBackupDue(p(), "2026-10-08", 0), false);                       // 記録が無ければ出さない
  assert.equal(isBackupDue(p({ interval_days: 0 }), "2027-01-01", 5), false);   // オフ
  assert.equal(isBackupDue(p({ snoozed_until: "2026-10-09" }), "2026-10-08", 5), false);
  assert.equal(isBackupDue(p({ snoozed_until: "2026-10-09" }), "2026-10-09", 5), true);
  assert.equal(isBackupDue(p({ last_backup_at: "2026-10-05T09:00:00" }), "2026-10-11", 5), false);   // 最後のバックアップから6日
  assert.equal(isBackupDue(p({ last_backup_at: "2026-10-05T09:00:00" }), "2026-10-12", 5), true);
  assert.equal(isBackupDue(p({ interval_days: 14, last_backup_at: "2026-10-05T09:00:00" }), "2026-10-18", 5), false);
  assert.equal(daysSinceBackup(p({ last_backup_at: "2026-10-05T09:00:00" }), "2026-10-12"), 7);
  assert.equal(daysSinceBackup(p(), "2026-10-12"), null);
});

// ── API: 保存 ──
test("save_backup: バックアップを保存し、最後のバックアップの日時を記録する(リマインダーは延期が解除される)", async () => {
  const t = await setup();
  try {
    t.api.add_record("2026-10-27", "1h", "x", [1], [], "manual");
    t.api.snooze_backup_reminder();
    const r = await t.api.save_backup();
    assert.equal(r.ok, true); assert.equal(r.records, 1); assert.equal(r.filename, "b.json");
    const s = t.calls.saved[0];
    assert.equal(s.filename, "study_tracker_backup_2026-10-27.json");
    const v = parseBackupText(s.text);
    assert.equal(v.ok, true); assert.equal(v.files["records.json"].length, 1);
    assert.equal(JSON.parse(s.text).format, BACKUP_FORMAT);
    const st = t.api.get_backup_status();
    assert.equal(st.last_backup_at, "2026-10-27T10:00:00");
    assert.equal(st.days_since, 0);
    assert.equal(st.due, false);
    assert.equal(st.can_pick_location, true);
    assert.equal(t.store.getMeta("backup_prefs").snoozed_until, null);
  } finally { t.restore(); }
});

test("save_backup: 保存先を選ばずに閉じたら記録しない / 失敗したら ok:false", async () => {
  const t = await setup({ saveResult: { ok: true, cancelled: true } });
  try {
    assert.deepEqual(await t.api.save_backup(), { ok: true, cancelled: true });
    assert.equal(t.api.get_backup_status().last_backup_at, null);
    t.platform.saveResult = { ok: false, error: "disk full" };
    assert.deepEqual(await t.api.save_backup(), { ok: false, error: "disk full" });
    assert.equal(t.api.get_backup_status().last_backup_at, null);
  } finally { t.restore(); }
});

test("バックアップに、メタ情報(リマインダーの設定・控え)は含まれない", async () => {
  const t = await setup();
  try {
    t.api.add_record("2026-10-27", "1h", "x", [], [], "manual");
    await t.api.save_backup();
    const files = JSON.parse(t.calls.saved[0].text).files;
    assert.deepEqual(Object.keys(files).sort().every((k) => k.endsWith(".json") && !k.includes("backup_prefs")), true);
    assert.equal("backup_prefs" in files, false);
  } finally { t.restore(); }
});

// ── API: リマインダー ──
test("リマインダー: 周期の変更・あとで・初回は『使い始めた日』から数える", async () => {
  const t = await setup({ now: "2026-10-01T09:00:00" });
  try {
    t.api.add_record("2026-10-01", "1h", "x", [], [], "manual");
    assert.equal(t.api.get_backup_status().due, false);
    t.setNow("2026-10-08T09:00:00");
    assert.equal(t.api.get_backup_status().due, true);
    t.api.snooze_backup_reminder();
    assert.equal(t.api.get_backup_status().due, false);
    t.setNow("2026-10-09T09:00:00");
    assert.equal(t.api.get_backup_status().due, true);
    assert.deepEqual(t.api.set_backup_interval(14), { ok: true });
    assert.equal(t.api.get_backup_status().due, false);
    assert.equal(t.api.get_backup_status().interval_days, 14);
    assert.equal(t.api.set_backup_interval(0).ok, true);
    t.setNow("2027-01-01T09:00:00");
    assert.equal(t.api.get_backup_status().due, false);
    for (const bad of [-1, 366, 1.5, "7", null]) assert.equal(t.api.set_backup_interval(bad).ok, false, String(bad));
  } finally { t.restore(); }
});

// ── API: 復元(上書き)・元に戻す ──
test("復元(上書き): 検証 → 控え → 置き換え。元に戻すと、復元前の状態に戻る", async () => {
  const t = await setup();
  try {
    t.api.add_record("2026-10-26", "1h", "いまの記録", [], [], "manual");
    t.api.update_setting("theme", "dark");
    const before = sortMs(t.store.exportAll());

    t.platform.picked = file(good());
    const p = await t.api.pick_backup_file();
    assert.equal(p.ok, true);
    assert.equal(p.summary.incoming.records, 1);
    assert.equal(p.summary.current.records, 1);
    assert.equal(p.summary.format, "backup");
    assert.equal(p.summary.app_version, "3.0.0");

    const r = await t.api.apply_backup("replace");
    assert.deepEqual(r, { ok: true, mode: "replace", records: 1 });
    assert.equal(t.api.get_records()[0].content, "x");                                // バックアップの内容
    assert.equal(t.api.get_settings().theme, "dark");
    assert.equal(t.api.get_points_balance(), 5);
    assert.equal(t.api.get_backup_status().last_backup_at, "2026-10-27T10:00:00");    // 復元した内容は、そのバックアップの時点のもの
    assert.equal(t.api.get_backup_status().undo.reason, "上書き復元の直前");

    const u = await t.api.undo_last_restore();
    assert.equal(u.ok, true);
    same_files(sortMs(t.store.exportAll()), before);
    assert.equal(t.api.get_backup_status().undo, null);
    assert.equal((await t.api.undo_last_restore()).ok, false);                        // 2回は戻せない
  } finally { t.restore(); }
});
function same_files(a, b) { const { same } = makeSame(); same(a, b); }

test("復元(上書き): 開き直しても、復元したデータが残る(IndexedDB)", async () => {
  const t = await setup();
  try {
    t.platform.picked = file(good());
    await t.api.pick_backup_file();
    await t.api.apply_backup("replace");
    await t.store.flush(); t.store.close();
    const again = await openStorage({ indexedDB: t.idb });
    const api2 = new Api(again);
    assert.equal(api2.get_records().length, 1);
    assert.equal(api2.get_settings().theme, "dark");
    assert.equal(again.getMeta("pre_restore_snapshot").reason, "上書き復元の直前");
  } finally { t.restore(); }
});

test("復元: 選ばれていない・方法が不正・不正なファイルでは、何も変更しない", async () => {
  const t = await setup();
  try {
    t.api.add_record("2026-10-26", "1h", "いまの記録", [], [], "manual");
    const before = sortMs(t.store.exportAll());
    assert.equal((await t.api.apply_backup("replace")).ok, false);
    t.platform.picked = null;
    assert.deepEqual(await t.api.pick_backup_file(), { ok: true, cancelled: true });
    t.platform.picked = file(good());
    await t.api.pick_backup_file();
    assert.equal((await t.api.apply_backup("bogus")).ok, false);
    for (const bytes of [enc("{壊れた"), enc(JSON.stringify({ format: "x" })), new Uint8Array([0xff, 0xfe, 0x00]),
      enc(JSON.stringify({ ...good(), files: { "records.json": [{ id: 1, date: "bad", minutes: 1 }] } }))]) {
      t.platform.picked = { name: "x.json", bytes };
      const p = await t.api.pick_backup_file();
      assert.equal(p.ok, false);
      assert.equal((await t.api.apply_backup("replace")).ok, false);                // 不正なものは「選ばれた状態」にならない
    }
    same_files(sortMs(t.store.exportAll()), before);
    assert.equal(t.store.getMeta("pre_restore_snapshot", null), null);              // 控えも作られていない
  } finally { t.restore(); }
});

test("復元: BOM つきの JSON も読める", async () => {
  const t = await setup();
  try {
    t.platform.picked = { name: "b.json", bytes: enc("\ufeff" + JSON.stringify(good())) };
    assert.equal((await t.api.pick_backup_file()).ok, true);
  } finally { t.restore(); }
});

// ── API: 記録だけ統合 ──
test("統合: 足りない記録だけを足し、重複は足さない。ポイント・設定・報酬は動かさない", async () => {
  const t = await setup();
  try {
    t.api.add_exam("模試", "2026-11-20", 100);
    t.api.add_record("2026-10-20", "30", "同じ内容", [1], [], "manual");              // バックアップにも同じ記録がある
    t.api.add_record("2026-10-21", "30", "同じ内容", [1], [], "manual");              // ↑と日付違い(別の記録)
    const balance = t.api.get_points_balance();
    const settings = structuredClone(t.api.get_settings());

    const bk = buildBackup({
      "records.json": [
        { id: 7, date: "2026-10-20", minutes: 30, content: "同じ内容", tag_ids: [1], exam_ids: [], source: "manual", quality: 3, points_earned: 9 },      // 重複
        { id: 8, date: "2026-10-19", minutes: 45, content: "足される", tag_ids: [1, 90, 91], exam_ids: [3, 4], source: "stopwatch", quality: 5, points_earned: 12, start_time: "08:30" },
        { id: 9, date: "2026-10-19", minutes: 45, content: "足される", tag_ids: [1, 90, 91], exam_ids: [3, 4], source: "stopwatch", quality: 5, points_earned: 12 },    // 同じ内容が2つ → 2つとも足される
      ],
      "tags.json": [{ id: 1, name: "数学", color: "#4A90D9" }, { id: 90, name: "新タグ", color: "#abcdef" }],   // 91 は定義なし → 無視
      "exams.json": [{ id: 3, name: "模試", date: "2026-11-20", goal_minutes: 100, goal_bonus_points: 70, goal_achieved: false, created_date: "2026-10-01" },
                     { id: 4, name: "新試験", date: "2026-12-01", goal_minutes: 50, goal_bonus_points: 20, goal_achieved: true, created_date: "2026-10-02" }],
      "points.json": { balance: 99999, history: [] }, "settings.json": { theme: "light" },
    }, "2026-10-27T09:00:00");
    t.platform.picked = file(bk);
    assert.equal((await t.api.pick_backup_file()).ok, true);
    const r = await t.api.apply_backup("merge");
    assert.deepEqual(r, { ok: true, mode: "merge", added: 2, duplicates: 1, new_tags: ["新タグ"], new_exams: ["新試験"] });

    const recs = t.api.get_records();
    assert.equal(recs.length, 4);
    const added = recs.filter((x) => x.content === "足される");
    assert.equal(added.length, 2);
    const newTag = t.api.get_tags().find((x) => x.name === "新タグ");
    assert.equal(newTag.color, "#abcdef");
    const exams = t.api.get_exams();
    const exam1 = exams.find((e) => e.name === "模試"), exam2 = exams.find((e) => e.name === "新試験");
    assert.equal(exams.length, 2);                                                   // 「模試」は名前+日付が同じなので作らない
    assert.equal(exam2.goal_achieved, true);                                        // 達成ずみの印も引き継ぐ(ボーナスの二重付与なし)
    for (const a of added) {
      assert.deepEqual(a.tag_ids, [1, newTag.id]);
      assert.deepEqual(a.exam_ids, [exam1.id, exam2.id]);
      assert.equal(a.source, "stopwatch"); assert.equal(a.points_earned, 12);
    }
    assert.equal(added.filter((x) => x.start_time === "08:30").length, 1);
    assert.equal(new Set(recs.map((x) => x.id)).size, 4);                            // id は重複しない
    assert.equal(t.api.get_points_balance(), balance);                              // ポイント・設定は変わらない
    assert.deepEqual(t.api.get_settings(), settings);
    assert.equal(t.api.get_backup_status().undo.reason, "記録の統合の直前");

    // もう一度同じ統合 → すべて重複
    t.platform.picked = file(bk);
    await t.api.pick_backup_file();
    const again = await t.api.apply_backup("merge");
    assert.equal(again.added, 0); assert.equal(again.duplicates, 3);
  } finally { t.restore(); }
});

test("統合: 記録を含まないバックアップは統合できない / ファイルに tags が無ければ既定のタグ名で結びつける", async () => {
  const t = await setup();
  try {
    t.platform.picked = file(buildBackup({ "settings.json": { theme: "dark" } }, "2026-10-27T09:00:00"));
    await t.api.pick_backup_file();
    const r = await t.api.apply_backup("merge");
    assert.equal(r.ok, false); assert.match(r.error, /記録が含まれていません/);
    assert.equal(t.store.getMeta("pre_restore_snapshot", null), null);

    t.platform.picked = file(buildBackup({ "records.json": [{ id: 1, date: "2026-10-20", minutes: 10, content: "a", tag_ids: [2], exam_ids: [] }] }, "2026-10-27T09:00:00"));
    await t.api.pick_backup_file();
    const ok = await t.api.apply_backup("merge");
    assert.equal(ok.added, 1);
    assert.deepEqual(t.api.get_records()[0].tag_ids, [2]);                          // 既定のタグ 2(英語)に結びつく
    assert.deepEqual(ok.new_tags, []);
  } finally { t.restore(); }
});

test("reload_app / 全データ削除のあとは、控え・リマインダーの設定も消える", async () => {
  const t = await setup();
  try {
    t.platform.picked = file(good());
    await t.api.pick_backup_file();
    await t.api.apply_backup("replace");
    assert.deepEqual(t.api.reload_app(), { ok: true });
    assert.equal(t.calls.reloads, 1);
    await t.api.reset_all_data();
    assert.equal(t.store.getMeta("pre_restore_snapshot", null), null);
    assert.equal(t.store.getMeta("backup_prefs", null), null);
  } finally { t.restore(); }
});

test("統合: 日付・時間・内容が同じでも、タグが違えば別の記録として足す(タグの順番だけが違うなら、同じ記録)", async () => {
  const t = await setup();
  try {
    t.api.add_record("2026-10-20", "30", "同じ", [1, 2], [], "manual");              // 数学・英語
    const rec = (id, tags) => ({ id, date: "2026-10-20", minutes: 30, content: "同じ", tag_ids: tags, exam_ids: [], source: "manual", quality: 3, points_earned: 1 });
    t.platform.picked = file(buildBackup({ "records.json": [rec(2, [3]), rec(3, []), rec(1, [2, 1])] }, "2026-10-27T09:00:00"));
    await t.api.pick_backup_file();
    const r = await t.api.apply_backup("merge");
    assert.equal(r.added, 2);                                                       // [2,1] は同じ記録。[3](物理)と [](タグなし)は別。(タグが違うものを先に並べて、重複の判定がタグを見ていることを確かめる)
    assert.equal(r.duplicates, 1);
    assert.deepEqual(t.api.get_records().map((x) => x.tag_ids).sort(), [[], [1, 2], [3]].sort());
  } finally { t.restore(); }
});
