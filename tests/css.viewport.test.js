// 画面の高さの単位の決まりごと: スマホ・タブレットでは、ブラウザの上下のバーが出入りして「見えている高さ」が変わる。
// 100vh は「バーが引っ込んだときの高さ」なので、バーが出ていると下が隠れる。そこで dvh(実際に見えている高さ)を使う。
// dvh を知らない古いブラウザのために、同じ項目に vh も先に書いておく(読めない行は読み飛ばされる)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../ui/css/", import.meta.url);
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
const css = (f) => stripComments(readFileSync(new URL(f, dir), "utf8"));

test("CSS の vh は、すべて直後に同じ項目の dvh 版が書かれている(vh だけの行が残らない)", () => {
  let nVh = 0;
  for (const f of files) {
    const s = css(f);
    for (const m of s.matchAll(/([a-z-]+)\s*:\s*([^;}]*\dvh\b[^;}]*)/g)) {
      nVh++;
      const [whole, prop, value] = m;
      const want = `${prop}:${value.replace(/(\d)vh\b/g, "$1dvh")}`;
      const rest = s.slice(m.index + whole.length, m.index + whole.length + want.length + 20).replace(/\s+/g, "");
      assert.ok(rest.includes(want.replace(/\s+/g, "")), `${f}: 「${whole.trim()}」の後ろに「${want}」が無い`);
    }
  }
  assert.ok(nVh >= 4, `vh が ${nVh} 個しか見つからない(確認が空回りしている)`);
});

test("全画面の外枠(.app)とサイドバー(.nav)、ポップアップの高さが dvh を使っている", () => {
  const shell = css("shell.css");
  assert.match(shell, /\.app\{[^}]*min-height:100dvh/);
  assert.match(shell, /\.nav\{[^}]*height:100dvh/);
  const comp = css("components.css");
  assert.match(comp, /\.modal-overlay\{[^}]*padding:8dvh/);
  assert.match(comp, /\.modal-box\{[^}]*max-height:calc\(100dvh - 12dvh\)/);
});

test("JS が作る見た目の指定(style 文字列)に、vh は使われていない", () => {
  const walk = (u) => readdirSync(u, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(new URL(`${e.name}/`, u)) : e.name.endsWith(".js") ? [new URL(e.name, u)] : []);
  for (const u of walk(new URL("../ui/js/", import.meta.url))) {
    assert.doesNotMatch(readFileSync(u, "utf8"), /\dvh\b/, `${u.pathname} に vh がある`);
  }
});
