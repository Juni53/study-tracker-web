"""Web 版が、Python 版と「意図して」変えている動作の一覧と、その変更を Python 版のコピーに当てる処理。

golden(期待値)は、元の Python 版を動かして作る。けれど、Web 版で意図して変えた動作まで Python 版に合わせると、
照合のテストが「変えたこと」を間違いとして扱ってしまう。そこで、golden を作るときだけ、Python 版の「コピー」に、
下の変更を当ててから動かす(元の Python 版のファイルは、いっさい書き換えない)。
→ 照合のテストは、「ここに書いた違い以外は、Python 版と完全に一致している」ことを、確かめ続ける。

変更を足したら、README_web.md の「Python 版との意図した違い」にも書くこと。
"""
import os
import re
import shutil
import tempfile

# (名前, 対象ファイル, 取り除く / 置き換える前の文字列(正規表現), 置き換え後)
DIVERGENCES = [
    (
        "さぼり券: 起動しただけの日も対象にする",
        "data_manager.py",
        # Python 版は、起動ログにある日(起動だけはしていた日)に達したら、遡るのをやめていた。その2行を取り除く
        r"[ \t]*if iso in launch_log:\n[ \t]*break[^\n]*\n",
        "",
    ),
    # さぼりペナルティ(ポイントの消失)の 1 日ぶんの金額は、四捨五入した「整数」にする(Python 版は、小数第 2 位まで)。
    # 四捨五入 = ちょうど半分は切り上げ(2.5 → 3。Python の round は偶数丸めで 2.5 → 2 になるので、使わない)。
    # 計算の途中のごく小さな誤差(25.499999999999996 など)で、半分の判定が狂わないよう、小数第 9 位で丸めてから判定する(JS 版の roundHalfUp と同じ)。
    # なお、Python 版は「ペナルティが 0 より大きいとき」だけ引くので、金額が 0 に丸まる残高(rate が 2% なら 25 ポイント未満)は、減らない。
    # ペナルティが入る場所は 2 つ(毎日の判定と、過去の日付の記録を足したとき)。メッセージの行で、それぞれを特定する。
    (
        "さぼりペナルティ: 金額は四捨五入した整数(毎日の判定)",
        "data_manager.py",
        r'decay = round\(self\.points\["balance"\] \* rate, 2\)(\n[ \t]*if decay > 0:\n[ \t]*self\._add_points\(-decay, f"⚠️ サボりペナルティ \(-)',
        r'decay = int(round(self.points["balance"] * rate, 9) + 0.5)\g<1>',
    ),
    (
        "さぼりペナルティ: 金額は四捨五入した整数(過去の日付の記録を足したとき)",
        "data_manager.py",
        r'decay = round\(self\.points\["balance"\] \* rate, 2\)(\n[ \t]*if decay > 0:\n[ \t]*self\._add_points\(-decay, f"⚠️ サボりペナルティ\(過去記録分\))',
        r'decay = int(round(self.points["balance"] * rate, 9) + 0.5)\g<1>',
    ),
]


def patched_copy(src):
    """src(Python 版のフォルダ)を一時フォルダへコピーして、DIVERGENCES を当てる。パッチの当て先が見つからなければ、止める。"""
    dst = os.path.join(tempfile.mkdtemp(prefix="st_golden_src_"), "app")
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "data", ".git"))
    for name, fname, pattern, repl in DIVERGENCES:
        path = os.path.join(dst, fname)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        new, n = re.subn(pattern, repl, text)
        if n != 1:
            raise SystemExit(f"Web 版の意図した違い「{name}」を、Python 版({fname})に当てられません(一致 {n} 件)。Python 版が変わっていないか確認してください")
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(new)
    return dst
