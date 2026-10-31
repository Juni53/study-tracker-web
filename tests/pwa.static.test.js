// PWA の静的な決まりごと: マニフェスト・アイコン・HTML の指定・「サブパス公開でも動く(相対パス)」・オフライン用ファイルの網羅。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, sep } from "node:path";
import { build } from "../tools/build-pwa.mjs";

const UI = new URL("../ui", import.meta.url).pathname;
const read = (rel) => readFileSync(join(UI, rel), "utf8");
const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const pngSize = (rel) => { const b = readFileSync(join(UI, rel)); assert.equal(b.toString("latin1", 1, 4), "PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("manifest: 必須の項目・相対パス・アイコン(any と maskable)", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Study Tracker");
  assert.ok(m.short_name && m.short_name.length <= 13);          // ホーム画面での表示が切り詰められない目安(アプリ名の「Study Tracker」は13文字)
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "ja");
  assert.equal(m.start_url, "./");                    // サブパス(/リポジトリ名/)で公開しても、その中で開く
  assert.equal(m.scope, "./");
  assert.equal(m.id, "./");
  assert.match(m.background_color, /^#[0-9A-Fa-f]{6}$/);
  assert.match(m.theme_color, /^#[0-9A-Fa-f]{6}$/);
  const bySize = (s, purpose) => m.icons.find((i) => i.sizes === s && i.purpose === purpose);
  assert.ok(bySize("192x192", "any") && bySize("512x512", "any"), "192 と 512 の通常のアイコン");
  assert.ok(bySize("512x512", "maskable"), "maskable のアイコン");
  for (const icon of m.icons) {
    assert.ok(!icon.src.startsWith("/") && !/^https?:/.test(icon.src), `アイコンの指定は相対パス: ${icon.src}`);
    assert.equal(icon.type, "image/png");
    assert.deepEqual(pngSize(icon.src), icon.sizes.split("x").map(Number), `${icon.src} の大きさ`);
  }
});

test("アイコン: iOS 用と favicon の大きさ", () => {
  assert.deepEqual(pngSize("icons/apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(pngSize("icons/favicon-48.png"), [48, 48]);
});

test("index.html: manifest・アイコン・テーマ色(ライト/ダーク)・iOS 用の指定がある。参照先が実在する", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="icon"[^>]*href="icons\/favicon-48\.png"/);
  assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="theme-color" content="#F3F1E9" media="\(prefers-color-scheme: light\)">/);
  assert.match(html, /<meta name="theme-color" content="#1B1C1F" media="\(prefers-color-scheme: dark\)">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  for (const [, ref] of html.matchAll(/(?:href|src)="([^"#]+)"/g)) assert.ok(existsSync(join(UI, ref)), `${ref} が無い`);
});

test("サブパス公開(https://ユーザー名.github.io/リポジトリ名/)でも動く: ルート始まりの絶対パスを使っていない", () => {
  const bad = [];
  const patterns = [/(?:href|src|action)\s*=\s*["']\/(?!\/)/, /url\(\s*["']?\/(?!\/)/, /\bfrom\s+["']\/(?!\/)/, /\bimport\(\s*["']\/(?!\/)/,
    /\bfetch\(\s*["']\/(?!\/)/, /\.register\(\s*["']\/(?!\/)/, /\blocation\.(?:href|assign|replace)\s*=\s*["']\/(?!\/)/];
  for (const f of walk(UI).filter((p) => /\.(html|css|js|webmanifest)$/.test(p))) {
    const src = readFileSync(f, "utf8").split("\n");
    src.forEach((line, i) => { if (patterns.some((re) => re.test(line))) bad.push(`${relative(UI, f)}:${i + 1}: ${line.trim().slice(0, 80)}`); });
  }
  assert.deepEqual(bad, []);
});

test("オフラインで動く: 画面のどのファイルが import するファイルも、すべて実在し、保存の対象に入っている", () => {
  const root = mkdtempSync(join(tmpdir(), "st-pwa-"));
  const { files } = build({ dir: UI, out: join(root, "dist") });
  const set = new Set(files);
  const problems = [];
  for (const f of walk(UI).filter((p) => p.endsWith(".js") && relative(UI, p) !== "sw.js")) {
    const code = readFileSync(f, "utf8");
    const specs = [...code.matchAll(/\bfrom\s+["']([^"']+)["']/g), ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g), ...code.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    for (const spec of specs) {
      if (!spec.startsWith(".")) { problems.push(`${relative(UI, f)}: 相対パスでない import: ${spec}`); continue; }
      const target = relative(UI, resolve(dirname(f), spec)).split(sep).join("/");
      if (!existsSync(join(UI, target))) problems.push(`${relative(UI, f)}: ${spec} が実在しない`);
      else if (!set.has(target)) problems.push(`${relative(UI, f)}: ${target} が保存の対象に入っていない`);
    }
  }
  assert.deepEqual(problems, []);
  // 保存の対象は、ui/ の全ファイル(sw.js を除く)と一致する
  const all = walk(UI).map((p) => relative(UI, p).split(sep).join("/")).filter((p) => p !== "sw.js").sort();
  assert.deepEqual([...files].sort(), all);
  rmSync(root, { recursive: true, force: true });
});

test("sw.js: 書き換えの印が1組あり、開発版(unbuilt)は空の一覧・版 dev", () => {
  const sw = read("sw.js");
  assert.equal([...sw.matchAll(/\/\/ @build$/gm)].length, 2);
  assert.match(sw, /^const BUILD_ID = "dev"; \/\/ @build$/m);
  assert.match(sw, /^const PRECACHE = \[\]; \/\/ @build$/m);
  assert.ok(!/skipWaiting\(\)/.test(sw.split('addEventListener("install"')[1].split('addEventListener("activate"')[0]), "install で自動的に切り替えない");
});

test("GitHub Actions の公開ワークフロー: main への push で、テスト → ビルド → Pages へ公開の順", () => {
  const wf = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(wf, /on:\n  push:\n    branches: \[main\]/);
  assert.match(wf, /permissions:\n  contents: read\n  pages: write\n  id-token: write/);
  const steps = ["npm ci", "npm run test:tz", "node tools/build-pwa.mjs --out dist", "actions/configure-pages@", "actions/upload-pages-artifact@", "actions/deploy-pages@"];
  const positions = steps.map((s) => wf.indexOf(s));
  assert.ok(positions.every((p) => p >= 0), `見つからない手順: ${steps.filter((s, i) => positions[i] < 0)}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "手順の順番");
  assert.match(wf, /path: dist/);
  assert.match(wf, /environment:\n      name: github-pages/);
  assert.match(wf, /needs: build/);
  for (const [, action] of wf.matchAll(/uses:\s*(\S+)/g)) assert.match(action, /^[\w.-]+\/[\w.-]+@v\d+$/, `${action}: 主要バージョンを指定する`);
});
