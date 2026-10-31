#!/usr/bin/env python3
"""Study Tracker デスクトップ版のデータを、1つのJSONファイルにまとめる(Web版へ移行する用)。

使い方:
    python export_desktop_data.py
    python export_desktop_data.py --data-dir "D:\\backup\\StudyTracker" --out my_data.json

・標準ライブラリだけで動く(pip install 不要)。アプリ本体(data_manager.py)は読み込まない。
・読み取り専用: 元のデータは一切変更しない(フォルダも作らない)。
・既定のデータ場所はデスクトップ版と同じ:
    Windows  %APPDATA%\\StudyTracker
    macOS    ~/Library/Application Support/StudyTracker
    Linux    ~/.local/share/StudyTracker
・出力は study_tracker_desktop_data_<日時>.json (カレントフォルダ)。
・JSONが壊れているファイルがあれば、何も出力せずに止まる(データが欠けたまま移行しないため)。
"""

import argparse
import json
import os
import sys
from datetime import datetime

BUNDLE_FORMAT = "study-tracker-desktop-bundle"
BUNDLE_VERSION = 1

# デスクトップ版 data_manager.py が読み書きするJSON。存在しないものは「まだ使われていない」だけなので、読み飛ばす。
DATA_FILES = [
    "records.json",              # 勉強の記録
    "points.json",               # ポイント残高と履歴
    "rewards.json",              # ショップの報酬
    "settings.json",             # 設定(換算式・ポモドーロ等)
    "exams.json",                # 試験
    "tags.json",                 # タグ
    "milestones_achieved.json",  # 連続記録・目標ボーナスの付与済み記録
    "sabori_log.json",           # さぼり券を使った日
    "sabori_owned.json",         # さぼり券の所持枚数
    "launch_log.json",           # アプリを起動した日
    "decay_log.json",            # ポイント消失の最終適用日
]


def default_data_dir():
    # data_manager.get_data_dir() と同じ規則(ただしフォルダは作らない)
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.path.expanduser("~/.local/share")
    return os.path.join(base, "StudyTracker")


def read_files(data_dir):
    files, missing, broken = {}, [], []
    for name in DATA_FILES:
        path = os.path.join(data_dir, name)
        if not os.path.isfile(path):
            missing.append(name)
            continue
        try:
            with open(path, encoding="utf-8") as f:  # アプリは BOM なしの UTF-8 で書く
                files[name] = json.load(f)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as e:
            broken.append((name, str(e)))
    return files, missing, broken


def main():
    ap = argparse.ArgumentParser(description="Study Tracker のデスクトップ版データを1つのJSONにまとめる")
    ap.add_argument("--data-dir", help="データフォルダ(省略するとデスクトップ版の既定の場所)")
    ap.add_argument("--out", help="出力ファイル名(省略すると日時つきの名前)")
    args = ap.parse_args()

    data_dir = os.path.abspath(args.data_dir) if args.data_dir else default_data_dir()
    if not os.path.isdir(data_dir):
        print(f"データフォルダが見つかりません: {data_dir}")
        print("別の場所にある場合は --data-dir でフォルダを指定してください。")
        return 1

    files, missing, broken = read_files(data_dir)
    if broken:
        print("読み込めないファイルがあるため、中止しました(何も出力していません):")
        for name, err in broken:
            print(f"  {name}: {err}")
        return 1
    if "records.json" not in files:
        print(f"records.json が見つかりません: {data_dir}")
        print("正しいデータフォルダか確認してください。")
        return 1

    now = datetime.now()
    bundle = {
        "format": BUNDLE_FORMAT,
        "version": BUNDLE_VERSION,
        "exported_at": now.isoformat(timespec="seconds"),
        "source_platform": sys.platform,
        "files": files,
    }
    out = args.out or f"study_tracker_desktop_data_{now:%Y%m%d-%H%M%S}.json"
    out = os.path.abspath(out)
    if os.path.exists(out):
        print(f"同名のファイルがすでにあります。上書きしないため中止しました: {out}")
        return 1
    with open(out, "w", encoding="utf-8") as f:
        json.dump(bundle, f, ensure_ascii=False, indent=2)

    records = files["records.json"]
    points = files.get("points.json") or {}
    total_min = sum(r.get("minutes", 0) for r in records if isinstance(r, dict))
    print(f"まとめました: {out}")
    print(f"  元のフォルダ : {data_dir}")
    print(f"  記録         : {len(records)} 件(合計 {total_min // 60}時間{total_min % 60:02d}分)")
    print(f"  ポイント残高 : {points.get('balance', '-')}")
    print(f"  含めたファイル: {len(files)} 個")
    if missing:
        print(f"  見つからず読み飛ばした: {', '.join(missing)}(まだ使っていない機能なら問題ありません)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
