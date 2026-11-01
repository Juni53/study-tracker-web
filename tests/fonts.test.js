// フォント(手順8): 同梱するのは、JetBrains Mono(可変フォント1つ)だけ。日本語は端末のフォント。
// 以前は、存在しないフォントファイルを読みにいく @font-face が残っていて、公開サイトで毎回、読み込みに失敗していた。
// → 「CSS・HTML が読みにいくファイルは、すべて実在する」ことを、全体で確かめる。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { build } from "../tools/build-pwa.mjs";

const UI = new URL("../ui", import.meta.url).pathname;
const read = (p) => readFileSync(join(UI, p), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const cssFiles = readdirSync(join(UI, "css")).filter((f) => f.endsWith(".css"));
const isLocal = (u) => u && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);   // http: / data: / // / #… 以外 = このサイトの中のファイル

test("CSS の url() が指すファイルは、すべて実在する(読み込みに失敗する指定が無い)", () => {
  let n = 0;
  for (const f of cssFiles) {
    for (const m of stripComments(read(`css/${f}`)).matchAll(/url\(\s*(["']?)([^)"']+)\1\s*\)/g)) {
      if (!isLocal(m[2])) continue;
      n++;
      const path = resolve(dirname(join(UI, "css", f)), m[2].split(/[?#]/)[0]);
      assert.ok(existsSync(path), `css/${f}: url(${m[2]}) のファイルが無い`);
    }
  }
  assert.ok(n >= 1, "url() が1つも見つからない(確認が空回りしている)");
});

test("index.html の href / src が指すファイルは、すべて実在する", () => {
  const html = read("index.html");
  let n = 0;
  for (const m of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    if (!isLocal(m[1])) continue;
    n++;
    assert.ok(existsSync(resolve(UI, m[1].split(/[?#]/)[0])), `index.html: ${m[1]} のファイルが無い`);
  }
  assert.ok(n >= 5);
});

test("@font-face は、JetBrains Mono の可変フォント1つだけ(同梱していない日本語フォントの指定が無い)", () => {
  const faces = [];
  for (const f of cssFiles) for (const m of stripComments(read(`css/${f}`)).matchAll(/@font-face\s*\{([^}]*)\}/g)) faces.push(m[1].replace(/\s+/g, " ").trim());
  assert.equal(faces.length, 1, `@font-face が ${faces.length} 個ある`);
  assert.match(faces[0], /font-family:\s*"JetBrains Mono"/);
  assert.match(faces[0], /font-weight:\s*100 800/);       // 可変フォント: 太さの範囲
  assert.match(faces[0], /font-display:\s*swap/);          // 読み込み中も、文字を隠さない
  assert.match(faces[0], /src:\s*url\("\.\.\/fonts\/JetBrainsMono-Variable\.woff2"\)\s*format\("woff2"\)/);
  assert.doesNotMatch(faces[0], /Zen Kaku/);
});

test("フォントのファイル: woff2 として正しく、大きさが妥当。置いてある woff2 は、すべて CSS から使われている", () => {
  const dir = join(UI, "fonts");
  const woffs = readdirSync(dir).filter((f) => f.endsWith(".woff2"));
  assert.deepEqual(woffs, ["JetBrainsMono-Variable.woff2"]);
  const buf = readFileSync(join(dir, woffs[0]));
  assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2");
  assert.equal(buf.readUInt32BE(8), buf.length, "ヘッダーの長さと、ファイルの大きさが合わない(壊れている)");
  assert.ok(buf.length > 40_000 && buf.length < 200_000, `大きさが想定外: ${buf.length}`);
  const css = cssFiles.map((f) => read(`css/${f}`)).join("\n");
  for (const w of woffs) assert.ok(css.includes(`fonts/${w}`), `${w} が、CSS から使われていない(無駄に保存される)`);
});

test("フォントのライセンス: OFL 全文と著作権表示が、フォントと同じフォルダにある", () => {
  const ofl = read("fonts/OFL.txt");
  assert.match(ofl, /^Copyright 2020 The JetBrains Mono Project Authors/);
  assert.match(ofl, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.ok(ofl.length > 4000, "全文が切れている");
  const note = read("fonts/README.txt");
  for (const k of ["JetBrains Mono", "SIL Open Font License 1.1", "OFL.txt", "woff2 に変換しただけ", "tools/make_fonts.py"]) assert.ok(note.includes(k), k);
});

test("公開用ビルド: フォントとライセンス文も、オフライン用の保存の対象に入る(欠けると、その版は入らない作り)", () => {
  const out = join(mkdtempSync(join(tmpdir(), "st-font-")), "dist");
  const { files } = build({ dir: UI, out });
  for (const must of ["fonts/JetBrainsMono-Variable.woff2", "fonts/OFL.txt", "css/tokens.css"]) assert.ok(files.includes(must), `${must} が保存の対象に無い`);
  const total = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
  assert.ok(total < 1_200_000, `サイト全体が大きすぎる(${Math.round(total / 1000)}KB)。大きなファイルを入れるなら、この上限を意図して変える`);
  rmSync(join(out, ".."), { recursive: true, force: true });
});
