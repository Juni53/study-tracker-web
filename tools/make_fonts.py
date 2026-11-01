#!/usr/bin/env python3
"""同梱フォント(JetBrains Mono)を作る。
使い方:  python tools/make_fonts.py <JetBrainsMono[wght].ttf のパス>   → ui/fonts/JetBrainsMono-Variable.woff2
・元ファイル: https://github.com/google/fonts/tree/main/ofl/jetbrainsmono の「JetBrainsMono[wght].ttf」(可変フォント。太さ 100〜800 を1ファイルで持つ)
・加工は「形式の変換(TTF → woff2)」だけ。文字(グリフ)を減らしたり、名前を変えたりはしない。
・必要なもの: pip install fonttools brotli
・フォントのライセンス(SIL OFL 1.1)の全文と著作権表示は、ui/fonts/OFL.txt に同梱してある(配布するときの条件)。
"""
import argparse
import os
import sys

from fontTools.ttLib import TTFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ui", "fonts", "JetBrainsMono-Variable.woff2")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ttf", help="JetBrainsMono[wght].ttf のパス")
    args = ap.parse_args()
    font = TTFont(args.ttf)
    if "fvar" not in font:
        sys.exit("可変フォント(JetBrainsMono[wght].ttf)を指定してください")
    font.flavor = "woff2"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    font.save(OUT)
    axes = {a.axisTag: (a.minValue, a.maxValue) for a in font["fvar"].axes}
    print(f"書き出しました: {os.path.normpath(OUT)}  ({os.path.getsize(OUT) / 1000:.0f} KB, 軸 {axes})")


if __name__ == "__main__":
    main()
