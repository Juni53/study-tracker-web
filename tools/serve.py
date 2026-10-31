#!/usr/bin/env python3
"""Study Tracker (Web 版) を、手元のパソコンで開くための簡易サーバー。

使い方(プロジェクトのフォルダで):
    python tools/serve.py              自分のパソコンだけ:  http://localhost:8000/
    python tools/serve.py --lan        同じLAN(Wi-Fi)の他の端末からも開けるようにする
    python tools/serve.py 8080 --lan   ポートを変える(※ポートが違うと、保存されるデータも別になる)
    python tools/serve.py --root dist  公開用のビルド(node tools/build-pwa.mjs)を試す(オフライン対応・インストールも、ここで確かめられる)
止めるとき: Ctrl+C

・Python 標準の http.server は、Windows では .js を text/plain として返す環境があり、そうするとブラウザが
  モジュール(import)の読み込みを拒否する。それを避けるため、種類(MIME)を明示している。
・既定(--lan なし)は、自分のパソコンからだけ接続できる(127.0.0.1 のみ)。
・--lan は、同じネットワークの他の端末にも公開する。公開するのは ui/ の中身だけ(学習データはブラウザの中にあり、
  このサーバーには無い)。それでも、カフェ・学校・ホテルなど、知らない人が同じネットワークにいる場所では使わないこと。
  接続を受け付けるのは、家庭内などのプライベートなアドレスの端末だけ(インターネット側からは拒否する)。
・開発用に、ファイルは毎回読み直される(キャッシュしない)。
"""
import argparse
import http.server
import ipaddress
import mimetypes
import os
import socket
import sys

MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".html": "text/html",
        ".woff2": "font/woff2", ".png": "image/png"}
for _ext, _mime in MIME.items():
    mimetypes.add_type(_mime, _ext)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ui")


def client_allowed(addr):
    """接続してきた端末が、手元・家庭内などの「プライベートなアドレス」なら True。インターネット上のアドレスは False。"""
    try:
        ip = ipaddress.ip_address(addr.split("%")[0])
    except ValueError:
        return False
    if getattr(ip, "ipv4_mapped", None):          # ::ffff:192.168.0.5 の形
        ip = ip.ipv4_mapped
    return not ip.is_global                        # 自分自身・プライベート・リンクローカル・CGNAT(100.64/10)など


def lan_addresses():
    """この PC の、LAN 側のアドレス(他の端末から使うもの)を返す。見つからなければ空。"""
    found = []
    try:                                           # 外向きの経路に使われるアドレス(UDP の connect は、実際には何も送らない)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))
        found.append(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        found += [i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET)]
    except OSError:
        pass
    out = []
    for a in found:
        ip = ipaddress.ip_address(a)
        if ip.is_loopback or ip.is_link_local or ip.is_global or a in out:
            continue
        out.append(a)
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}

    root = ROOT

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=self.root, **kw)

    def _guard(self):
        if client_allowed(self.client_address[0]):
            return True
        self.send_error(403, "Forbidden")
        return False

    def do_GET(self):
        if self._guard():
            super().do_GET()

    def do_HEAD(self):
        if self._guard():
            super().do_HEAD()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser(description="Study Tracker (Web 版)の簡易サーバー")
    ap.add_argument("port", nargs="?", type=int, default=8000)
    ap.add_argument("--lan", action="store_true", help="同じLANの他の端末からも開けるようにする")
    ap.add_argument("--root", default=None, help="公開するフォルダ(省略すると ui/)。ビルド後の dist などを指定できる")
    args = ap.parse_args()

    if args.root:
        Handler.root = os.path.abspath(args.root)
    if not os.path.isfile(os.path.join(Handler.root, "index.html")):
        sys.exit(f"index.html が見つかりません: {os.path.abspath(Handler.root)}")
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    try:
        srv = http.server.ThreadingHTTPServer((host, args.port), Handler)
    except OSError as e:
        sys.exit(f"ポート {args.port} で起動できません({e})。別のポート番号を指定してください。例: python tools/serve.py {args.port + 1}")

    print(f"起動しました。  このパソコンでは:  http://localhost:{args.port}/")
    if args.lan:
        addrs = lan_addresses()
        print()
        print("同じ Wi-Fi / LAN につながっている他の端末では、次のアドレスを開いてください:")
        for a in addrs:
            print(f"    http://{a}:{args.port}/")
        if not addrs:
            print("    (LAN のアドレスを自動で見つけられませんでした。ipconfig で IPv4 アドレスを調べて、http://<そのアドレス>:%d/ を開いてください)" % args.port)
        print()
        print("注意:")
        print("  ・初めて起動したとき、Windows のファイアウォールの確認が出たら『プライベート ネットワーク』だけにチェックして許可する。")
        print("  ・カフェ・学校・ホテルなど、知らない人がいるネットワークでは使わない。")
        print("  ・開けないときは、ゲスト用 Wi-Fi など『端末どうしの通信を禁止』している接続でないか確認する。")
        print("  ・http のアドレスでは、ブラウザの制限で一部の機能(複数タブの防止・永続化の要求・将来の PWA など)が使えない。")
        print("    Chrome / Edge では、下記の設定で、そのアドレスを例外として許可できる(試験用):")
        print("      chrome://flags/#unsafely-treat-insecure-origin-as-secure  (Edge は edge://flags/...)")
        print("      → 『Enabled』にして、入力欄に上のアドレス(例: http://192.168.0.5:%d)を書き、ブラウザを再起動" % args.port)
    print("\n止めるには Ctrl+C")
    with srv:
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            print("\n停止しました")


if __name__ == "__main__":
    main()
