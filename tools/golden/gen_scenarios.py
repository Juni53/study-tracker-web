#!/usr/bin/env python3
"""状態を持つ処理(記録・ポイント・連続記録・さぼり券・消失・目標・ショップ・タグ・試験)を、
Python 版で「台本どおりに」動かし、各ステップの戻り値と保存データを記録する(JS 版との照合用)。

台本は2種類:
  ・手書きの場面(旧形式の連続記録キーの移行、さぼり券の自動適用と払い戻し、ポイント消失、不正な日付)
  ・乱数で作る長い場面(シード固定。数か月ぶんの毎日の操作、長期の不在、設定変更などを混ぜる)

使い方:
    python tools/golden/gen_scenarios.py --src ../study_tracker_app --out tests/golden

・「今日」と「いま」は固定して動かす(Python 版の date.today() / datetime.now() を差し替え)。
・アプリの起動(Api の生成)は台本の "init" ステップ。起動時の処理(さぼり券の自動適用・ポイント消失)も含めて照合する。
・本物のデータには触らない(HOME / APPDATA を一時フォルダにする)。
"""
import argparse
import gzip
import json
import os
import random
import shutil
import sys
import tempfile
import types
from datetime import datetime as _dt, timedelta

FILES = ["records.json", "points.json", "rewards.json", "settings.json", "exams.json", "tags.json",
         "milestones_achieved.json", "sabori_log.json", "sabori_owned.json", "launch_log.json", "decay_log.json"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", type=int, default=10, help="乱数の場面の数")
    ap.add_argument("--days", type=int, default=90, help="乱数の場面の長さ(日)")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="st_scn_")
    os.environ["HOME"] = tmp
    os.environ["APPDATA"] = tmp
    sys.path.insert(0, os.path.abspath(args.src))
    sys.modules.setdefault("webview", types.ModuleType("webview"))
    import data_manager as dm
    import api as api_mod

    # ── 時間の固定 ──
    class Clock:
        now = _dt(2026, 1, 1)

    class FDatetime(_dt):
        @classmethod
        def now(cls, tz=None):
            return Clock.now

    import datetime as _datetime_mod
    class FDate(_datetime_mod.date):
        @classmethod
        def today(cls):
            return Clock.now.date()

    for mod in (dm, api_mod):
        if hasattr(mod, "datetime"):
            mod.datetime = FDatetime
        if hasattr(mod, "date"):
            mod.date = FDate

    DATA_DIR = dm.DATA_DIR
    import copy
    ORIG_TAGS = copy.deepcopy(dm.DEFAULT_TAGS)

    def reset(initial):
        # Python 版は、tags.json が無いとき DEFAULT_TAGS(モジュール内のリスト)そのものを返し、add_tag / update_tag がそれを
        # 書き換えてしまう。アプリは起動のたびにプロセスが新しくなるので実害は無いが、この生成スクリプトは1つのプロセスで
        # 複数の場面を動かすので、場面ごとに元へ戻す(JS 版は毎回コピーを使うので、この癖は持ち込まない)。
        dm.DEFAULT_TAGS[:] = copy.deepcopy(ORIG_TAGS)
        shutil.rmtree(DATA_DIR, ignore_errors=True)
        os.makedirs(DATA_DIR)
        for name, value in (initial or {}).items():
            with open(os.path.join(DATA_DIR, name), "w", encoding="utf-8") as f:
                json.dump(value, f, ensure_ascii=False)

    def snapshot():
        out = {}
        for name in FILES:
            p = os.path.join(DATA_DIR, name)
            if os.path.exists(p):
                with open(p, encoding="utf-8") as f:
                    out[name] = json.load(f)
        if "milestones_achieved.json" in out:
            out["milestones_achieved.json"] = sorted(out["milestones_achieved.json"])   # 保存順は不定(set 由来)
        return out

    bundle_counter = [0]

    def make_bundle():
        """この場面の最終状態を、本物の移行スクリプト(tools/export_desktop_data.py)で 1 つの JSON にまとめたもの。
        JS 版が「デスクトップ版のデータを読み込めるか」の照合に使う。records.json が無い(空の)状態では作れないので None。"""
        import subprocess
        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "export_desktop_data.py")
        bundle_counter[0] += 1
        out = os.path.join(tmp, f"bundle_{bundle_counter[0]}.json")
        r = subprocess.run([sys.executable, script, "--data-dir", DATA_DIR, "--out", out], capture_output=True, text=True,
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        if r.returncode != 0:
            return None
        with open(out, encoding="utf-8") as f:
            return json.load(f)

    class Runner:
        def __init__(self, name, initial=None, snap_every=40):
            self.sc = {"name": name, "initial": initial or {}, "steps": []}
            self.api = None
            self.snap_every = snap_every
            reset(initial)

        def _snap(self, step, force=False):
            if force or len(self.sc["steps"]) % self.snap_every == 0:
                step["snapshot"] = snapshot()

        def init(self, now):
            Clock.now = _dt.fromisoformat(now)
            self.api = api_mod.Api()
            step = {"now": now, "init": True}
            self._snap(step, force=True)
            self.sc["steps"].append(step)

        def call(self, now, method, *argv):
            Clock.now = _dt.fromisoformat(now)
            # 引数は、記録用と呼び出し用で別々のコピーにする(Python 版は渡されたリストをそのまま記録に保持し、
            # あとで delete_tag などが中身を書き換えるため、共有すると記録した引数まで変わってしまう)
            step = {"now": now, "call": method, "args": json.loads(json.dumps(argv))}
            try:
                r = getattr(self.api, method)(*json.loads(json.dumps(argv)))
                step["result"] = json.loads(json.dumps(r, allow_nan=False))
            except (ValueError, TypeError, KeyError, OverflowError, ArithmeticError) as e:
                step["throws"] = True
                self._snap(step, force=True)       # 例外のあとの保存状態も照合する(途中まで保存されることがあるため)
            self.sc["steps"].append(step)
            if "snapshot" not in step:
                self._snap(step)
            return step.get("result")

        def export_csv(self, now):
            """Python 版の export_csv が書き出したファイルの中身(BOM つき)を記録する。"""
            Clock.now = _dt.fromisoformat(now)
            path = os.path.join(tmp, "probe_export.csv")
            self.api.dm.export_csv(path)
            with open(path, encoding="utf-8", newline="") as f:   # 改行を変換せずに読む(\r\n のまま)。先頭の BOM は \ufeff として残る
                step = {"now": now, "call": "export_csv", "csv": f.read()}
            self.sc["steps"].append(step)
            return step["csv"]

        def import_bytes(self, now, raw):
            """バイト列を CSV として取り込む(Python 版は、ファイルのパスを渡す)。結果と、保存データを記録する。"""
            import base64
            Clock.now = _dt.fromisoformat(now)
            path = os.path.join(tmp, "probe_import.csv")
            with open(path, "wb") as f:
                f.write(raw)
            step = {"now": now, "call": "import_csv_bytes", "b64": base64.b64encode(raw).decode("ascii")}
            try:
                step["result"] = json.loads(json.dumps(self.api.dm.import_csv(path), allow_nan=False))
            except Exception:                                  # csv.Error など(JS 版は、エラーの結果として返す)
                step["throws_in_python"] = True
            step["snapshot"] = snapshot()
            self.sc["steps"].append(step)
            return step.get("result")

        def finish(self):
            self.sc["steps"][-1]["snapshot"] = snapshot()
            self.sc["bundle"] = make_bundle()
            return self.sc

    scenarios = []
    D = lambda s: s  # 読みやすさ用

    # ───────── 手書きの場面 ─────────
    # A. 旧形式の連続記録キーの移行
    days = [(_dt(2026, 10, 27) - timedelta(days=i)).date().isoformat() for i in range(10)]
    recs = [{"id": i + 1, "date": d, "minutes": 60, "content": "x", "tag_ids": [], "exam_ids": [], "source": "manual",
             "quality": 3, "points_earned": 30} for i, d in enumerate(reversed(days))]
    r = Runner("legacy-streak-keys", {"records.json": recs, "milestones_achieved.json": ["streak_7", "streak_14", "monthly_2026-09"],
                                      "points.json": {"balance": 100.0, "history": []}})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:05:00", "add_record", "2026-10-27", "30", "追加", [1], [], "manual")
    for q in [("get_home_data",), ("get_calendar_month", 2026, 10, 0), ("get_calendar_month", 2026, 10, 1), ("get_calendar_month", "2026", "9", "1"),
              ("get_stats", "week"), ("get_stats", "month"), ("get_stats", "all")]:
        r.call("2026-10-27T09:06:00", *q)
    scenarios.append(r.finish())

    # B. さぼり券の自動適用 → 後から記録を足して払い戻し
    recs = [{"id": 1, "date": "2026-10-20", "minutes": 60, "content": "a", "tag_ids": [], "exam_ids": [], "source": "manual",
             "quality": 3, "points_earned": 30}]
    r = Runner("sabori-apply-refund", {"records.json": recs, "sabori_owned.json": {"owned": 2},
                                       "launch_log.json": ["2026-10-22"], "points.json": {"balance": 500.0, "history": []}})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:10:00", "add_record", "2026-10-25", "1h", "遡って記録", [], [], "manual")
    r.call("2026-10-27T09:20:00", "buy_sabori_ticket")
    r.call("2026-10-27T09:21:00", "buy_sabori_ticket")
    r.call("2026-10-27T09:22:00", "buy_sabori_ticket")
    r.init("2026-10-29T08:00:00")
    for q in [("get_home_data",), ("get_calendar_month", 2026, 10, 0), ("get_stats", "week"), ("get_stats", "all")]:
        r.call("2026-10-29T08:01:00", *q)
    scenarios.append(r.finish())

    # C. ポイント消失(長い空白 → 翌日以降)
    recs = [{"id": 1, "date": "2026-10-01", "minutes": 60, "content": "a", "tag_ids": [], "exam_ids": [], "source": "manual",
             "quality": 3, "points_earned": 30}]
    r = Runner("decay-long-gap", {"records.json": recs, "points.json": {"balance": 1000.0, "history": []}})
    r.init("2026-10-27T09:00:00")
    r.init("2026-10-27T18:00:00")
    r.init("2026-10-28T09:00:00")
    r.call("2026-10-28T09:05:00", "add_record", "2026-10-28", "2h", "復帰", [], [], "stopwatch", 4, "08:30")
    r.call("2026-10-28T09:06:00", "add_record", "2026-10-10", "30", "過去分", [], [], "manual")
    r.init("2026-11-20T09:00:00")
    scenarios.append(r.finish())

    # D. 目標(月間・試験)と試験日の境目
    r = Runner("goals", {})
    r.init("2026-10-01T08:00:00")
    r.call("2026-10-01T08:01:00", "update_setting", "monthly_goal_min", 200)
    r.call("2026-10-01T08:02:00", "add_exam", "テストA", "2026-10-05", 120)
    r.call("2026-10-01T08:03:00", "add_exam", "テストB", "2026-10-03", 60, 15)
    r.call("2026-10-02T08:00:00", "add_record", "2026-10-02", "1h", "A1", [1], [1, 2], "stopwatch", 3, "07:10")
    r.call("2026-10-04T08:00:00", "add_record", "2026-10-04", "1h", "A2(Bの試験日の後)", [1], [1, 2], "manual")
    r.call("2026-10-05T08:00:00", "add_record", "2026-10-05", "1h", "A3", [2], [1], "manual")
    r.call("2026-10-06T08:00:00", "get_exams")
    r.call("2026-10-06T08:01:00", "delete_exam", 1)
    r.call("2026-10-06T08:02:00", "delete_tag", 1)
    r.call("2026-10-06T08:03:00", "get_exams")
    for q in [("get_home_data",), ("get_calendar_month", 2026, 10, 0), ("get_calendar_month", 2026, 2, 1), ("get_stats", "week"), ("get_stats", "month"), ("get_stats", "all")]:
        r.call("2026-10-06T08:04:00", *q)
    scenarios.append(r.finish())

    # E. 不正な日付(途中まで保存されたあとに例外になる)
    r = Runner("invalid-date", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_record", "2026-10-27", "30", "ok", [], [], "manual")
    r.call("2026-10-27T09:02:00", "add_record", "2026-13-45", "30", "bad", [], [], "manual")
    r.call("2026-10-27T09:03:00", "add_record", "2026-02-30", "30", "bad2", [], [], "manual")
    r.call("2026-10-27T09:04:00", "add_record", "2026-10-27", "abc", "bad3", [], [], "manual")
    r.call("2026-10-27T09:05:00", "get_records")
    for q in [("get_home_data",), ("get_calendar_month", 2026, 13, 0), ("get_calendar_month", 2026, 0, 0), ("get_stats", "week")]:
        r.call("2026-10-27T09:06:00", *q)
    scenarios.append(r.finish())

    # F. さぼり券を遡る上限(30日)。所持上限を大きくして、30日を超える空白で確かめる
    recs = [{"id": 1, "date": "2026-09-01", "minutes": 60, "content": "a", "tag_ids": [], "exam_ids": [], "source": "manual",
             "quality": 3, "points_earned": 30}]
    r = Runner("sabori-lookback-cap", {"records.json": recs, "sabori_owned.json": {"owned": 40},
                                       "settings.json": {"sabori_max_owned": 40, "decay_days": 100},
                                       "points.json": {"balance": 10.0, "history": []}})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "get_shop")
    scenarios.append(r.finish())

    # G. 空のデータ(最初の起動)での問い合わせ
    r = Runner("empty-queries", {})
    r.init("2026-03-15T09:00:00")
    for q in [("get_home_data",), ("get_calendar_month", 2026, 3, 0), ("get_calendar_month", 2026, 3, 1), ("get_calendar_month", 2026, 2, 0),
              ("get_stats", "week"), ("get_stats", "month"), ("get_stats", "all"), ("get_shop",)]:
        r.call("2026-03-15T09:01:00", *q)
    scenarios.append(r.finish())

    # H. 品質が 0 / null / 範囲外の記録(平均品質・品質分布の扱い)と、試験の経過率の上限
    r = Runner("odd-quality", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_exam", "経過率", "2026-10-30", 100)
    for q in [0, None, 5, 3, 7, 1]:
        r.call("2026-10-27T09:02:00", "add_record", "2026-10-27", "30", f"q={q}", [], [1], "manual", q)
    for q in [("get_stats", "week"), ("get_stats", "month"), ("get_stats", "all"), ("get_home_data",), ("get_exams",)]:
        r.call("2026-10-27T09:03:00", *q)
    r.call("2026-11-02T09:03:00", "get_home_data")          # 試験日を過ぎた後(直近の試験なし)
    r.init("2026-10-29T09:00:00")
    r.call("2026-10-29T09:03:00", "get_home_data")
    scenarios.append(r.finish())

    # I. 丸めが「ちょうど中間」になる値(Python は偶数丸め: round(12.5) = 12。JS の Math.round は 13)
    r = Runner("rounding-ties-compare", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:02:00", "add_record", "2026-10-19", "8", "先週", [], [], "manual", 4)       # 先週 8分
    r.call("2026-10-27T09:03:00", "add_record", "2026-10-26", "9", "今週", [], [], "manual", 3)       # 今週 9分(前の週より 12.5% 増)
    r.call("2026-10-27T09:05:00", "get_stats", "week")
    scenarios.append(r.finish())

    r = Runner("rounding-ties-exam", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_exam", "半端", "2026-11-04", 8)                                # 作成日 10-27 〜 試験日 11-04(8日間)
    r.call("2026-10-28T09:00:00", "add_record", "2026-10-28", "1", "試験", [], [1], "manual", 3)      # 目標 8分のうち 1分 = 12.5%
    for q in [("get_exams",), ("get_home_data",)]:
        r.call("2026-10-28T09:05:00", *q)
    scenarios.append(r.finish())

    r = Runner("rounding-ties-tags", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_record", "2026-10-27", "25", "A", [1], [], "manual")
    r.call("2026-10-27T09:02:00", "add_record", "2026-10-27", "175", "B", [2], [], "manual")
    r.call("2026-10-27T09:03:00", "get_home_data")            # タグ A は 25 / 200 = 12.5%
    r.call("2026-10-27T09:03:00", "get_stats", "week")
    scenarios.append(r.finish())

    # J. CSV の書き出しと取り込み
    import csv as _csv, io as _io

    def mk(rows, header="date,minutes,content,tags,exams,source,quality,points_earned", eol="\r\n"):
        buf = _io.StringIO(newline="")
        w = _csv.writer(buf, lineterminator=eol)
        if header:
            w.writerow(header.split(","))
        for row in rows:
            w.writerow(row)
        return buf.getvalue()

    r = Runner("csv-roundtrip", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_exam", "模試A", "2026-11-20", 100)
    r.call("2026-10-27T09:01:30", "add_exam", "模試,B", "2026-11-25", 100)
    r.call("2026-10-27T09:02:00", "add_tag", "タグ,カンマ", "#123456")
    odd = ['改行\nを含む', 'カンマ,を含む', '引用符"を含む', ' 前後に空白 ', "絵文字😀", "", "日本語の内容", 'a\r\nb']
    for i, c in enumerate(odd):
        r.call("2026-10-27T09:03:00", "add_record", f"2026-10-{20 + i % 7:02d}", ["30", "1h", "45", "2h5m", "90"][i % 5],
               c, [1 + i % 3, 7] if i % 2 else [], [1] if i % 3 == 0 else ([2] if i % 4 == 0 else []), "manual" if i % 2 else "stopwatch", 1 + i % 5,
               f"{8 + i:02d}:15" if i % 2 == 0 else None)
    csv1 = r.export_csv("2026-10-27T10:00:00")
    r.import_bytes("2026-10-27T10:01:00", csv1.encode("utf-8"))                # 全部が重複
    r.call("2026-10-27T10:02:00", "delete_record", 2)
    r.call("2026-10-27T10:02:30", "delete_record", 5)
    r.import_bytes("2026-10-27T10:03:00", csv1.encode("utf-8"))                # 消した分だけ戻る
    r.import_bytes("2026-10-27T10:04:00", csv1.encode("utf-8-sig"))            # BOM 二重(utf-8-sig で書き直した扱い)
    r.export_csv("2026-10-27T10:05:00")
    scenarios.append(r.finish())

    r = Runner("csv-import-variants", {})
    r.init("2026-10-27T09:00:00")
    r.call("2026-10-27T09:01:00", "add_exam", "期末", "2026-12-01", 600)
    r.call("2026-10-27T09:01:10", "add_exam", "期末", "2026-12-02", 600)       # 同名の試験(最初のものに結びつく)
    r.call("2026-10-27T09:02:00", "add_record", "2026-10-26", "30", "既存", [1], [], "manual", 3)
    r.call("2026-10-27T09:02:10", "add_record", "2026-10-26", "30", "既存", [1], [], "manual", 3)   # 同じ内容の記録が2つ
    H = "date,minutes,content,tags,exams,source,quality,points_earned"
    variants = [
        ("通常+重複2つ+3つ目は新規", mk([["2026-10-26", 30, "既存", "数学", "", "manual", 3, 5.0]] * 3).encode("utf-8")),
        ("不正な行いろいろ", mk([
            ["2026-13-01", 30, "月が不正", "", "", "manual", 3, 0], ["2026-10-27", 30, "今日はOK", "", "", "manual", 3, 0],
            ["2026-10-28", 30, "未来", "", "", "manual", 3, 0], ["20261026", 30, "形式違い", "", "", "manual", 3, 0],
            ["2026-10-20", 0, "0分", "", "", "manual", 3, 0], ["2026-10-20", -5, "負", "", "", "manual", 3, 0],
            ["2026-10-20", 1.5, "小数", "", "", "manual", 3, 0], ["2026-10-20", "abc", "文字", "", "", "manual", 3, 0],
            ["2026-10-20", "", "空", "", "", "manual", 3, 0], ["2026-10-20", "45.0", "45.0は可", "", "", "manual", 3, 0],
            ["2026-10-20", "nan", "nan", "", "", "manual", 3, 0],      # (inf は Python 版が例外で止まるので、ここには入れない)
            ["", 10, "日付が空", "", "", "manual", 3, 0], [],
            ["2026-10-19", 20, "品質あれこれ", "", "", "stopwatch", "0", "-3"], ["2026-10-19", 21, "品質あれこれ", "", "", "stopwatch", "6", "abc"],
            ["2026-10-19", 22, "品質あれこれ", "", "", "weird", "4.9", "12.345"], ["2026-10-19", 23, "品質あれこれ", "", "", "", "-", ""],
            ["2026-10-19", 24, "品質あれこれ", "", "", "manual", "nan", "1e2"],
        ]).encode("utf-8")),
        ("タグと試験", mk([
            ["2026-10-18", 10, "t1", "数学, 新タグ1 ,新タグ1,英語", "期末", "manual", 3, 1],
            ["2026-10-18", 11, "t2", ",,新タグ2,", "存在しない試験,期末,期末", "manual", 3, 1],
            ["2026-10-18", 12, "t3", "あ,い,う,え,お,か,き,く,け,こ", "", "manual", 3, 1]]).encode("utf-8")),
        ("見出しの揺れ", mk([["2026-10-17", 5, "x"]], header=" DATE , Minutes ,Content").encode("utf-8")),
        ("列が足りない", mk([["2026-10-17", 5, "x"]], header="date,content").encode("utf-8")),
        ("見出しだけ", (H + "\r\n").encode("utf-8")),
        ("空ファイル", b""),
        ("空行だけ", b"\n\n"),
        ("cp932 で保存(Excel)", mk([["2026-10-16", 15, "全角ｶﾅ①日本語", "数学", "", "manual", 3, 2]]).encode("cp932")),
        ("BOM つき UTF-8", mk([["2026-10-15", 15, "BOM", "", "", "manual", 3, 2]]).encode("utf-8-sig")),
        ("LF だけ・最後に改行なし", mk([["2026-10-14", 15, "LF", "", "", "manual", 3, 2]], eol="\n").rstrip("\n").encode("utf-8")),
        ("引用符つき改行", ('date,minutes,content\r\n2026-10-13,10,"複数行の\r\n内容"\r\n2026-10-12,10,"閉じない').encode("utf-8")),
        ("列の途中で行が終わる", (H + "\n2026-10-11,10\n2026-10-10\n").encode("utf-8")),
        ("文字コード不明(UTF-8 でも cp932 でもない)", b"date,minutes\n2026-10-09,5\n\x81"),
    ]
    for i, (name, raw) in enumerate(variants):
        r.import_bytes(f"2026-10-27T10:{i:02d}:00", raw)
    r.call("2026-10-27T11:00:00", "get_tags")
    r.call("2026-10-27T11:00:10", "get_stats", "all")
    r.export_csv("2026-10-27T11:01:00")
    scenarios.append(r.finish())

    # ───────── 乱数の場面 ─────────
    DURS = ["15", "25", "45", "1h", "1h30m", "2:15", "90", "0", "3h", "12", "1.5h", "7"]
    FORMULAS = [None, "30 * hour ^ 1.6", "floor(20 * hour ^ 1.5)", "minutes / 2", "floor(10 * log(minutes + 1))"]

    for seed in range(1, args.seeds + 1):
        rnd = random.Random(seed)
        r = Runner(f"fuzz-{seed}", {})
        day0 = _dt(2026, 6, 1)
        tstr = lambda d, h, m=0, s=0: d.replace(hour=h, minute=m, second=s).isoformat(timespec="seconds")
        r.init(tstr(day0, 8))
        # 最初に、設定や試験・報酬を少し用意する
        t = tstr(day0, 8, 1)
        r.call(t, "update_setting", "monthly_goal_min", rnd.choice([300, 600, 3000]))
        r.call(t, "update_setting", "decay_days", rnd.choice([3, 5, 7]))
        r.call(t, "update_setting", "decay_rate", rnd.choice([0.02, 0.05, 0.1]))
        r.call(t, "update_setting", "streak_bonus_days", rnd.choice([3, 5, 7]))
        r.call(t, "update_setting", "sabori_max_owned", rnd.choice([1, 2, 3]))
        r.call(t, "update_setting", "sabori_price", rnd.choice([50, 100, 500]))
        for nm, c in [("本", 100), ("ゲーム 🎮", 300), ("おやつ", 40.4), ("映画", 250)]:
            r.call(t, "add_reward", nm, c, rnd.random() < 0.3, False)
        r.call(t, "add_exam", "模試1", (day0 + timedelta(days=20)).date().isoformat(), 300)
        r.call(t, "add_exam", "模試2", (day0 + timedelta(days=50)).date().isoformat(), 400, 25)

        d = day0
        for day_i in range(args.days):
            d = day0 + timedelta(days=day_i)
            if rnd.random() < 0.08:                      # ときどき長期の不在
                d += timedelta(days=rnd.randint(3, 14))
                day0 += timedelta(days=(d - (day0 + timedelta(days=day_i))).days)
            if rnd.random() < 0.9:
                r.init(tstr(d, rnd.randint(6, 10), rnd.randint(0, 59), rnd.randint(0, 59)))
            hour = 10
            for _ in range(rnd.choice([0, 1, 1, 2, 3, 4])):
                hour = min(23, hour + rnd.randint(0, 3))
                now = tstr(d, hour, rnd.randint(0, 59), rnd.randint(0, 59))
                api = r.api
                recs = api.dm.records
                tags = [x["id"] for x in api.dm.tags]
                exams = [x["id"] for x in api.dm.exams]
                rewards = [x for x in api.dm.rewards]
                op = rnd.choices(
                    ["add_sw", "add_manual", "add_past", "delete", "update", "buy_sabori", "buy_reward", "reward_edit",
                     "reward_order", "exam", "tag", "setting", "query"],
                    weights=[22, 14, 6, 4, 4, 5, 6, 5, 3, 4, 4, 4, 8])[0]
                if op in ("add_sw", "add_manual", "add_past"):
                    date = d.date() if op != "add_past" else (d - timedelta(days=rnd.randint(1, 25))).date()
                    ts = rnd.sample(tags, k=min(len(tags), rnd.randint(0, 2))) if tags else []
                    es = rnd.sample(exams, k=min(len(exams), rnd.randint(0, 2))) if exams else []
                    st = f"{rnd.randint(0, 23):02d}:{rnd.randint(0, 59):02d}" if op == "add_sw" and rnd.random() < 0.8 else None
                    r.call(now, "add_record", date.isoformat(), rnd.choice(DURS), f"勉強{rnd.randint(1, 99)}", ts, es,
                           "stopwatch" if op == "add_sw" else "manual", rnd.randint(1, 5), st)
                elif op == "delete" and recs:
                    r.call(now, "delete_record", rnd.choice(recs)["id"])
                elif op == "update" and recs:
                    rec = rnd.choice(recs)
                    patch = rnd.choice([{"content": "編集"}, {"tag_ids": rnd.sample(tags, k=min(1, len(tags)))},
                                        {"content": "両方", "exam_ids": exams[:1]}])
                    r.call(now, "update_record", rec["id"], patch)
                elif op == "buy_sabori":
                    r.call(now, "buy_sabori_ticket")
                elif op == "buy_reward" and rewards:
                    r.call(now, "buy_reward", rnd.choice(rewards)["id"], rnd.choice([1, 1, 2, "3", 0, "x", 2.9]))
                elif op == "reward_edit":
                    k = rnd.choice(["add", "update", "flag", "delete"])
                    if k == "add":
                        r.call(now, "add_reward", rnd.choice(["新しい報酬", "", "  ", "x" * 41, "絵文字🍎" * 8, "ok"]),
                               rnd.choice([100, "250", "abc", 0, -5, 49.5, 50.5, 10 ** 8, None]), rnd.random() < 0.3, rnd.random() < 0.3)
                    elif rewards:
                        rw = rnd.choice(rewards)
                        if k == "update":
                            r.call(now, "update_reward", rw["id"], rnd.choice(["改名", "", "名前2"]), rnd.choice([120, "x", 75]))
                        elif k == "flag":
                            r.call(now, "set_reward_flag", rw["id"], rnd.choice([None, True, False]), rnd.choice([None, True, False]))
                        else:
                            r.call(now, "delete_reward", rw["id"])
                elif op == "reward_order" and rewards:
                    ids = [x["id"] for x in api.dm._shop_grid_rewards()]
                    if rnd.random() < 0.6:
                        rnd.shuffle(ids)
                    elif rnd.random() < 0.5 and ids:
                        ids = ids[:-1]
                    r.call(now, "set_reward_order", ids)
                elif op == "exam":
                    k = rnd.choice(["add", "update", "delete"])
                    if k == "add":
                        r.call(now, "add_exam", f"試験{rnd.randint(1, 9)}", (d + timedelta(days=rnd.randint(-5, 40))).date().isoformat(),
                               rnd.choice([60, 120, 240]), rnd.choice([None, None, 20]))
                    elif exams:
                        eid = rnd.choice(exams)
                        if k == "update":
                            r.call(now, "update_exam", eid, "改名試験", (d + timedelta(days=rnd.randint(0, 30))).date().isoformat(), rnd.choice([30, 90]))
                        else:
                            r.call(now, "delete_exam", eid)
                elif op == "tag":
                    k = rnd.choice(["add", "update", "delete", "reorder"])
                    if k == "add":
                        r.call(now, "add_tag", f"タグ{rnd.randint(1, 20)}", "#112233")
                    elif tags:
                        if k == "update":
                            r.call(now, "update_tag", rnd.choice(tags), "改名タグ", "#abcdef")
                        elif k == "delete" and len(tags) > 2:
                            r.call(now, "delete_tag", rnd.choice(tags))
                        elif k == "reorder":
                            ids = tags[:]
                            rnd.shuffle(ids)
                            r.call(now, "reorder_tags", ids + ([999] if rnd.random() < 0.2 else []))
                elif op == "setting":
                    k, v = rnd.choice([("decay_days", rnd.choice([3, 5, 7, 10])), ("decay_rate", rnd.choice([0.01, 0.02, 0.05])),
                                       ("monthly_goal_min", rnd.choice([200, 600, 0])), ("streak_bonus_days", rnd.choice([2, 3, 5, 7, 0])),
                                       ("streak_bonus_points", rnd.choice([10, 30, 55.5])), ("point_formula", rnd.choice(FORMULAS) or dm.DEFAULT_SETTINGS["point_formula"]),
                                       ("manual_point_formula", rnd.choice(["floor(points * 0.75)", "points / 3", "bad("]))])
                    r.call(now, "update_setting", k, v)
                elif op == "query":
                    k = rnd.choice(["simple", "home", "calendar", "calendar", "stats", "stats"])
                    if k == "home":
                        r.call(now, "get_home_data")
                    elif k == "calendar":
                        mo = d.month + rnd.choice([-1, 0, 0, 0, 1])
                        yr = d.year + (mo - 1) // 12
                        r.call(now, "get_calendar_month", yr, (mo - 1) % 12 + 1, rnd.choice([0, 1]))
                    elif k == "stats":
                        r.call(now, "get_stats", rnd.choice(["week", "month", "all", "all", "bogus"]))
                    r.call(now, rnd.choice(["get_shop", "get_exams", "get_points_balance", "get_tags", "get_records", "get_settings"]))
                    r.call(now, "get_reward_cost_reference", rnd.choice([40, 100, 300, 5000, 0, "x"]), rnd.choice([1, 2, 3]))
                    r.call(now, "preview_points", rnd.choice(DURS), rnd.choice(["stopwatch", "manual"]))
        scenarios.append(r.finish())

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, "scenarios.json.gz")
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(scenarios, f, ensure_ascii=False, allow_nan=False)
    n_steps = sum(len(s["steps"]) for s in scenarios)
    print(f"scenarios={len(scenarios)} steps={n_steps} size={os.path.getsize(path) // 1024}KB")


if __name__ == "__main__":
    main()
