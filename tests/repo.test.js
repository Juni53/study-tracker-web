// 公開リポジトリの体裁(手順8): LICENSE(MIT)・利用者向け README・フォントのライセンスが、そろっていて、アプリの実際と食い違わない。
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildNavItems } from "../ui/js/core/nav.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(resolve(ROOT, p), "utf8");

test("LICENSE: MIT ライセンスの全文(著作権表示つき)。package.json も MIT", () => {
  const t = read("LICENSE");
  assert.match(t, /^MIT License\n/);
  assert.match(t, /^Copyright \(c\) 2026 \S+/m);
  for (const k of ["Permission is hereby granted, free of charge", "The above copyright notice and this permission notice shall be included", 'THE SOFTWARE IS PROVIDED "AS IS"']) assert.ok(t.includes(k), k);
  assert.equal(JSON.parse(read("package.json")).license, "MIT");
});

test("README.md: 利用者向けの案内がそろっている(サイト・できること・インストール・バックアップ・プライバシー・ライセンス)", () => {
  const t = read("README.md");
  assert.match(t, /^# Study Tracker/);
  assert.match(t, /https:\/\/juni53\.github\.io\/study-tracker-web\//);
  for (const k of ["## できること", "## 使い方", "## データについて", "## プライバシー", "## 開発する人へ", "## ライセンス",
                   "バックアップを保存", "外部のサーバーへは送られません", "共有ボタンから「ホーム画面に追加」", "MIT ライセンス", "SIL Open Font License 1.1", "JetBrains Mono"]) {
    assert.ok(t.includes(k), `README.md に「${k}」が無い`);
  }
});

test("README.md: 紹介しているタブの名前は、アプリのタブ(ホーム〜設定)と一致している", () => {
  const t = read("README.md");
  for (const n of buildNavItems({ feedback: false }).filter((n) => n.label)) {
    assert.ok(t.includes(`**${n.label}**`), `README.md に、タブ「${n.label}」の説明が無い(タブ名を変えたら README も直す)`);
  }
});

test("README.md: 相対リンクのファイルが、すべて実在する", () => {
  const t = read("README.md");
  let n = 0;
  for (const m of t.matchAll(/\]\(([^)]+)\)/g)) {
    const href = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) continue;
    n++;
    assert.ok(existsSync(resolve(ROOT, dirname("README.md"), href.split("#")[0])), `README.md のリンク先が無い: ${href}`);
  }
  assert.ok(n >= 3);
  assert.match(read("README_web.md"), /## デスクトップ版のデータを取り込む/, "README.md が案内している見出しが、README_web.md に無い");
});

test("README.md と、フォントの説明・ライセンスが矛盾しない(MIT はコード、フォントは OFL)", () => {
  assert.match(read("ui/fonts/OFL.txt"), /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(read("README.md"), /MIT ではなく/);
  assert.match(read("README_web.md"), /JetBrainsMono-Variable\.woff2/);
});
