"""serve.py の確認: python tools/test_serve.py"""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import serve


class ClientAllowed(unittest.TestCase):
    def test_allowed(self):
        for a in ["127.0.0.1", "::1", "192.168.0.5", "10.1.2.3", "172.16.5.4", "172.31.255.1", "169.254.1.1",
                  "100.64.0.9", "::ffff:192.168.0.5", "fe80::1%eth0", "fd00::1"]:
            self.assertTrue(serve.client_allowed(a), a)

    def test_denied(self):
        for a in ["8.8.8.8", "1.1.1.1", "172.32.0.1", "203.0.113.5" if False else "93.184.216.34", "2606:4700:4700::1111",
                  "::ffff:8.8.8.8", "not-an-ip", ""]:
            self.assertFalse(serve.client_allowed(a), a)


class LanAddresses(unittest.TestCase):
    def test_only_private_non_loopback(self):
        import ipaddress
        for a in serve.lan_addresses():
            ip = ipaddress.ip_address(a)
            self.assertFalse(ip.is_loopback or ip.is_link_local or ip.is_global, a)


class Guard(unittest.TestCase):
    """実際にサーバーを立てて、許可されない端末からの要求が 403 になることを確認する。"""

    def _get(self, allowed):
        import http.server, threading, urllib.request, urllib.error
        orig = serve.client_allowed
        serve.client_allowed = lambda addr: allowed
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            url = f"http://127.0.0.1:{srv.server_address[1]}/"
            try:
                with urllib.request.urlopen(url) as r:
                    return r.status, r.headers.get("Cache-Control")
            except urllib.error.HTTPError as e:
                return e.code, None
        finally:
            srv.shutdown(); srv.server_close(); serve.client_allowed = orig

    def test_allowed_client_gets_page(self):
        self.assertEqual(self._get(True), (200, "no-store"))

    def test_denied_client_gets_403(self):
        self.assertEqual(self._get(False)[0], 403)

    def test_js_is_served_as_javascript(self):
        import http.server, threading, urllib.request
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{srv.server_address[1]}/js/core/boot.js") as r:
                self.assertEqual(r.headers.get_content_type(), "text/javascript")
        finally:
            srv.shutdown(); srv.server_close()


class Root(unittest.TestCase):
    """--root で、公開するフォルダを変えられる(ビルド後の dist を試すため)。"""

    def test_root_override_serves_that_folder_only(self):
        import http.server, tempfile, threading, urllib.request, urllib.error
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
                f.write("<html>dist</html>")
            with open(os.path.join(d, "sw.js"), "w", encoding="utf-8") as f:
                f.write("// sw")
            old = serve.Handler.root
            serve.Handler.root = d
            srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), serve.Handler)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            try:
                base = f"http://127.0.0.1:{srv.server_address[1]}"
                with urllib.request.urlopen(base + "/") as r:
                    self.assertEqual(r.read().decode(), "<html>dist</html>")
                with urllib.request.urlopen(base + "/sw.js") as r:
                    self.assertEqual(r.headers.get_content_type(), "text/javascript")
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    urllib.request.urlopen(base + "/js/app.js")           # ui/ のファイルは、見えない
                self.assertEqual(cm.exception.code, 404)
                with self.assertRaises(urllib.error.HTTPError) as cm:
                    urllib.request.urlopen(base + "/../tools/serve.py")   # 外のファイルは、見えない
                self.assertIn(cm.exception.code, (400, 404))
            finally:
                srv.shutdown(); srv.server_close(); serve.Handler.root = old


if __name__ == "__main__":
    unittest.main(verbosity=2)
