#!/usr/bin/env python3
"""PWA のアイコンを作る(サイドバーのロゴ = 朱色の枠に「S」の判子、と同じ意匠)。
使い方:  python tools/make_icons.py [--font <ttf のパス>]   → ui/icons/ に PNG を書き出す
・生成済みの PNG を、リポジトリに入れてある。デザインを変えるときだけ、このスクリプトを使う。
・maskable は、端末が丸や角丸で切り抜いても欠けないよう、中身を中央の安全な範囲(直径80%の円の内側)に収める。
"""
import argparse
import os
from PIL import Image, ImageDraw, ImageFont

PAPER = (243, 241, 233)     # --paper
STAMP = (178, 58, 46)       # --stamp
SS = 4                      # 4 倍で描いて縮小する(輪郭をなめらかにする)

def render(size, margin, border_ratio, font_path, letter="S"):
    big = size * SS
    img = Image.new("RGB", (big, big), PAPER)
    d = ImageDraw.Draw(img)
    x0 = y0 = round(big * margin)
    x1 = y1 = big - x0 - 1
    side = x1 - x0
    d.rectangle([x0, y0, x1, y1], outline=STAMP, width=max(2, round(side * border_ratio)))
    font = ImageFont.truetype(font_path, round(side * 0.62))
    d.text((big / 2, big / 2 + side * 0.015), letter, font=font, fill=STAMP, anchor="mm")
    return img.resize((size, size), Image.LANCZOS)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default="/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ui", "icons"))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    specs = {
        "icon-192.png": (192, 0.14, 0.055),
        "icon-512.png": (512, 0.14, 0.055),
        "icon-maskable-512.png": (512, 0.24, 0.055),     # 安全な範囲に収める
        "apple-touch-icon.png": (180, 0.14, 0.055),
        "favicon-48.png": (48, 0.06, 0.08),
    }
    for name, (size, margin, border) in specs.items():
        render(size, margin, border, a.font).save(os.path.join(a.out, name), optimize=True)
        print("wrote", name, size)

if __name__ == "__main__":
    main()
