// タッチ操作まわりの CSS・見た目の決まりごと(ホバーの残り続け・タップ時の青い枠・ボタンの塗りつぶし)。
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(`../ui/${rel}`, import.meta.url), "utf8");
// コメントを、行数を保ったまま消す(コメントの中の「:hover」という文字を、規則と取り違えないため)
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
const HEAD = "@media (any-hover:hover){";
const PREFIX = ":where(:root:not(.is-touch)) ";

test("ホバーの規則は、すべて「ホバーできる端末だけ」かつ「タッチの間は無効」の形で書かれている", () => {
  let n = 0;
  for (const f of ["components.css", "shell.css", "views.css"]) {
    stripComments(read(`css/${f}`)).split("\n").forEach((line, i) => {
      if (!line.includes(":hover")) return;
      n++;
      const where = `${f}:${i + 1}`;
      assert.ok(line.startsWith(HEAD), `${where} が @media (any-hover:hover) で囲まれていない: ${line.slice(0, 60)}`);
      const selectors = line.slice(HEAD.length, line.indexOf("{", HEAD.length)).split(",");
      for (const sel of selectors) assert.ok(sel.trim().startsWith(PREFIX), `${where} に :where(:root:not(.is-touch)) が無い: ${sel}`);
      assert.ok(line.trimEnd().endsWith("}}"), `${where} の閉じ方`);
    });
  }
  assert.ok(n >= 25, `ホバー規則が ${n} 個しか見つからない(確認が空回りしている)`);
});

test("ホバーの規則は、他の規則の詳しさ(優先度)を変えない: :where() で包み、:active の規則より後ろに置かれたままである", () => {
  const css = stripComments(read("css/components.css"));
  assert.ok(!/:root:not\(\.is-touch\)(?<!:where\(:root:not\(\.is-touch\))/.test(css.replaceAll(":where(:root:not(.is-touch))", "")), ":where() の外に :root:not(.is-touch) がある");
  const lastHover = css.split("\n").findLastIndex((l) => l.includes(":hover"));
  const firstActive = css.split("\n").findIndex((l) => /\.btn[^{]*:active/.test(l));
  assert.ok(firstActive > lastHover, ":active の規則が、ホバーの規則より前にある");
});

test("タップしたときの、ブラウザ標準の青いハイライトを透明にしている", () => {
  const css = stripComments(read("css/tokens.css"));
  assert.match(css, /\*, \*::before, \*::after\{-webkit-tap-highlight-color:transparent;\}/);
});

test("バックアップを取るボタンは塗りつぶし(primary)、復元するボタンは枠だけ(muted)", () => {
  const src = read("js/views/settings.js");
  assert.match(src, /<button class="btn primary" id="backupSaveBtn">/);
  assert.match(src, /<button class="btn muted" id="backupRestoreBtn">/);
  assert.match(stripComments(read("css/components.css")), /\.btn\.primary\{background:var\(--ink\);/);
});

test("設定ページの2つの選択肢の列は、別のクラス・別の id で、スタイルは共通", () => {
  const src = read("js/views/settings.js");
  assert.match(src, /<div class="theme-row" id="themeRow">/);
  assert.match(src, /<div class="radio-row" id="backupInterval">/);
  assert.match(stripComments(read("css/views.css")), /\.theme-row, \.radio-row\{display:flex;/);
});
