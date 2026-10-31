#!/usr/bin/env python3
"""Python 版(元のアプリ)を「正解」として、JS 版と照合するためのデータ(golden)を作る。

使い方(Study Tracker 本体のフォルダを --src で指定):
    python tools/golden/gen_pure.py --src ../study_tracker_app --out tests/golden

出力:
    pure.json         純粋関数(round / parse_duration / fmt_time / 換算式 / ポイント計算)と、
                      Api.preview_points / calc_formula_preview の入出力
    api_surface.json  Python 版 Api の公開メソッド一覧(JS 版の抜け漏れチェック用)

・本物のデータには触らない: HOME / APPDATA を一時フォルダに差し替えてから読み込む。
・NaN / inf を含む結果は、JSON にできないので「例外」として記録する。
"""
import argparse
import json
import math
import os
import random
import sys
import tempfile
import types


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="元のアプリのフォルダ(data_manager.py がある場所)")
    ap.add_argument("--out", required=True, help="出力先フォルダ")
    args = ap.parse_args()

    tmp = tempfile.mkdtemp(prefix="st_golden_")
    os.environ["HOME"] = tmp
    os.environ["APPDATA"] = tmp
    sys.path.insert(0, os.path.abspath(args.src))
    sys.modules.setdefault("webview", types.ModuleType("webview"))

    import data_manager as dm
    import api as api_mod

    cases = []

    def rec(fn, call, *argv):
        """call(*argv) を実行して、結果(または例外)を記録する。"""
        c = {"fn": fn, "args": list(argv)}
        try:
            v = call(*argv)
            if isinstance(v, float) and not math.isfinite(v):
                c["throws"] = True
            else:
                json.dumps(v, allow_nan=False)
                c["expect"] = v
        except (ValueError, OverflowError, ArithmeticError, __import__("csv").Error):
            c["throws"] = True       # 想定内の失敗(読めない文字列など)だけを記録する。TypeError 等は、この生成スクリプトの誤りなので止める
        cases.append(c)

    # ── round ──
    ties = [0.5, 1.5, 2.5, 3.5, -0.5, -1.5, -2.5, 62.5, 63.5, 0.125, 0.375, 0.625, 2.675, 1.005, 1.115,
            0.285, 100.5, 12345.675, -2.675, 0.045, 0.055, 1.25, 1.35, 2.5e-1, 7.5, 0.0, 99.995, 0.994999]
    rnd = random.Random(1)
    rand = [round(rnd.uniform(-1000, 1000), rnd.choice([1, 2, 3, 6])) for _ in range(250)]
    rand += [rnd.random() * 10 ** rnd.randint(-3, 6) for _ in range(150)]
    sums = [0.1 + 0.2, 3.1 + 0.15, 12.35 + 0.1, 100 * 1.02, 250.5 * 0.02, 33.3 * 0.02, 74.99 * 0.75]
    for x in ties + rand + sums:
        for nd in (0, 2):
            rec("round", lambda v, n: int(round(v)) if n == 0 else round(v, n), x, nd)

    # ── parse_duration / fmt_time ──
    texts = ["90", "1.5", "0", "45", " 45 ", "1h", "1H", "1h30m", "1h30", "2H5M", "1.5h", "0h", "25h61m", "1.15h",
             "1:30", "01:05", "0:00", "10:7", "10:75", "1e2", "1_0", "-5", "+5", "5.", ".5", "", "abc", "1h 30m",
             "1h30m5", "inf", "-inf", "nan", "１２", "１ｈ", "１h３０m", "１:３０", "1：30", "0x10", "1,5", "1h-30",
             "3600000", "99999999999999999999", "1h30m.5", "\ufeff30", "\x1c30\x85", "\u300030\u3000", "30\xa0", "1.5.5", "1__0", "_1", "1_", "e5", "1e", "٣"]
    for t in texts:
        rec("parse_duration", dm.parse_duration, t)
    for n in [0, 1, 59, 60, 61, 125, 599, 600, 1439, 1440, 6000, -5, -60, -61, 90.7, 59.99, 3599.9]:
        rec("fmt_time", dm.fmt_time, n)

    # ── 換算式 ──
    formulas = [
        "floor(30 * (minutes / 60) ^ 1.6)", "floor(points * 0.75)", "floor(minutes/60*5)", "30 * hour ** 1.6",
        "30 * hour ^ 1.6", "sqrt(minutes)", "log(minutes)", "log(minutes, 10)", "log(minutes, 2)", "pow(hour, 2)",
        "ceil(hour * 10)", "minutes // 60", "minutes % 60", "-minutes", "2 ^ 3 ^ 2", "-2 ^ 2", "2 ^ -1",
        "(1+2)*3", "1/0", "sqrt(-1)", "log(0)", "log(5, 1)", "log(5, 0)", "unknown + 1", "floor", "floor(1,2)",
        "floor()", "minutes(", "", "   ", "1 +", "5 5", "0 ^ -1", "(-8) ^ (1/3)", "1e3", ".5 * minutes",
        "5. * hour", "min(1,2)", "abs(-1)", "minutes ** 0.5", "points * 0.75", "floor(points * 0.75)",
        "100 - minutes", "1_000", "7 // 2", "-7 // 2", "-7 % 3", "7 % -3", "7.5 // 2", "2 ** 0.5", "10 / 4",
        "floor(30 * hour ^ 1.6) + floor(points)", "(minutes", "minutes)", "minutes ** -1", "0 ** 0",
        "pow(2, 10)", "pow(-8, 1/3)", "pow(0, -1)", "floor(1,)", "- - minutes", "+minutes", "2 ^ ^ 3",
        "minutes * ", "hour * 60", "points", "points * points", "floor(minutes / 7) * 3 + 1",
        "log(minutes) * 10", "ceil(sqrt(minutes) * 3)", "1e400", "10 ^ 400", "minutes ^ 2 / 100",
    ]
    mins = [0, 1, 7, 25, 59, 60, 61, 90, 120, 150, 180, 360, 600, 1440]
    for f in formulas:
        for m in mins:
            rec("eval_formula", lambda fo, v: dm.eval_formula(fo, v, fallback=-1.0), f, {"minutes": m, "hour": m / 60})
        for p in [0, 0.5, 3, 12, 30.0, 45.5, 100]:
            rec("eval_formula", lambda fo, v: dm.eval_formula(fo, v, fallback=-1.0), f, {"points": p})

    # 既定の換算式を 1 分刻みで全部(floor の境目で JS と値がずれないかの確認。ここは完全一致を要求する)
    default_f = dm.DEFAULT_SETTINGS["point_formula"]
    sweep = {"formula": default_f,
             "values": [dm.calc_base_points(m, default_f) for m in range(0, 1441)]}
    sweep2 = {"formula": "floor(20 * hour ^ 1.5)",
              "values": [dm.calc_base_points(m, "floor(20 * hour ^ 1.5)") for m in range(0, 1441)]}

    # ── calc_base_points / calc_manual_points ──
    pairs = [(dm.DEFAULT_SETTINGS["point_formula"], dm.DEFAULT_SETTINGS["manual_point_formula"]),
             ("30 * hour ^ 1.6", "points * 0.7"), ("bad(", "bad("), ("minutes", "points / 3"), ("", "")]
    for mf, uf in pairs:
        for m in mins + [2, 3, 13, 44, 75, 200]:
            rec("calc_base_points", dm.calc_base_points, m, mf)
            rec("calc_manual_points", lambda a, b, c: list(dm.calc_manual_points(a, b, c)), m, mf, uf)

    # ── Api(既定の設定のまま) ──
    a = api_mod.Api()
    for t in ["90", "1h30m", "1.5h", "0", "25", "1:30", "abc", "", "-5", "0:00", "10:75", "１h", "3.7", "7"]:
        for src in ["stopwatch", "manual"]:
            rec("api.preview_points", a.preview_points, t, src)
    for f in ["floor(30 * (minutes / 60) ^ 1.6)", "minutes", "bad(", "30 * hour ^ 1.6"]:
        for m in [0, 25, 90, 150]:
            rec("api.calc_formula_preview", a.calc_formula_preview, f, m)
    rec("api.get_points_balance", a.get_points_balance)
    rec("api.get_settings", a.get_settings)

    # ── CSV(Python 標準の csv モジュールと同じ読み書きか) ──
    import base64
    import csv as _csv
    import io as _io

    def csv_row(row):
        buf = _io.StringIO(newline="")
        _csv.writer(buf).writerow(row)
        return buf.getvalue()

    def csv_read_rows(b64):
        # data_manager._read_csv_rows と同じ経路(文字コード判定 → csv.reader)
        path = os.path.join(tmp, "probe.csv")
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        return dm.DataManager._read_csv_rows(path)

    texts = ["", "\n", "a", "a,b", "a,b\n", "a,b\r\n", "a,b\r\nc,d\r\n", "a,b\nc,d", "a,,c", ",", ",,", "\"\"", "\"a\"", "\"a,b\",c",
             "\"a\"\"b\",c", "\"a\nb\",c\nd,e", "\"a\r\nb\",c", "a,\"b", "\"a", "\"a\n", "a\"b,c", "\"a\"b,c", "\"a\" ,b", " a , b ",
             "a\n\nb", "a\r\n\r\nb", "\n\na", "a\rb", "a\r", "\r", "\r\n", "\"\"\"\"", "\"\"\"a\"\"\"", "a,\"\"\n", "あ,い\nう,\"え\nお\"",
             "date,minutes,content,tags,exams,source,quality,points_earned\r\n2026-10-27,30,\"a,b\",数学,,manual,3,12.0\r\n",
             "\ufeffa,b", "a,\ufeffb", "a\x00b", "a,b\n\"c\"\"", "\"unterminated\n,still\n"]
    alpha = ["a", "b", ",", '"', '"', "\n", "\r", " ", "あ", "1"]
    rnd_c = random.Random(7)
    texts += ["".join(rnd_c.choice(alpha) for _ in range(rnd_c.randint(1, 30))) for _ in range(500)]
    for t in texts:
        rec("csv_parse", lambda x: list(_csv.reader(_io.StringIO(x))), t)

    vals = ["", "a", "a,b", 'a"b', "a\nb", "a\r\nb", " sp ", "あ", "1", "x" * 5, '""', ",", None, 3, 12.5, 30.5, 0, "-", "😀", "a\rb"]
    for row in [[v] for v in vals] + [[a, b] for a in vals[:8] for b in vals[:8]]:
        rec("csv_row", csv_row, row)
    for _ in range(200):
        rec("csv_row", csv_row, [rnd_c.choice(vals) for _ in range(rnd_c.randint(1, 8))])

    jp = "日付,時間,内容\r\n2026-10-27,30,数学の宿題(①)\r\n"
    blobs = [b"", b"a,b\n", "\ufeffa,b\n".encode("utf-8"), jp.encode("utf-8"), ("\ufeff" + jp).encode("utf-8"), jp.encode("cp932"),
             "date,minutes,content\n2026-10-27,30,ｱｲｳ半角カナ\n".encode("cp932"), b"\x81", "a\ufeffb".encode("utf-8"), "\ufeff\ufeffa".encode("utf-8")]
    for b in blobs:
        rec("csv_read_rows", csv_read_rows, base64.b64encode(b).decode("ascii"))

    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "pure.json"), "w", encoding="utf-8") as fp:
        json.dump({"cases": cases, "sweep": [sweep, sweep2]}, fp, ensure_ascii=False, allow_nan=False)
    surface = sorted(n for n in dir(api_mod.Api) if not n.startswith("_") and callable(getattr(api_mod.Api, n)))
    with open(os.path.join(args.out, "api_surface.json"), "w", encoding="utf-8") as fp:
        json.dump(surface, fp, ensure_ascii=False, indent=1)
    print(f"cases={len(cases)}  sweep={len(sweep['values'])}x2  api methods={len(surface)}")


if __name__ == "__main__":
    main()
