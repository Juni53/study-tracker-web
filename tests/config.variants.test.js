// config.js(フィードバックの URL など)は、公開する人が書き換える。どんな値でも、テストが通る(= CI が止まらない)ことを確かめる。
// ui/ と tests/ を一時フォルダへコピーし、config.js だけを書き換えて、設定に影響を受けるテストを、別のプロセスで動かす。
// (全部のテストを動かすと、このテスト自身が増殖するので、影響を受けるものだけ。ここに無いテストは、config.js を読まない。)
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSe-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/viewform?usp=publish-editor";
const AFFECTED = ["tests/feedback.test.js", "tests/onboarding.test.js", "tests/settings.pwa.test.js", "tests/views.smoke.test.js"];

const VARIANTS = [
  { name: "URL なし(空)", url: "", entry: "" },
  { name: "URL あり", url: FORM, entry: "" },
  { name: "URL あり + バージョンの質問番号あり", url: FORM, entry: "entry.1234567890" },
  { name: "https でない値(設定なし扱い)+ 番号あり", url: "forms.gle/abc", entry: "entry.1" },
];

for (const v of VARIANTS) {
  test(`config.js が「${v.name}」でも、設定に影響を受けるテストが全部通る`, () => {
    const dir = mkdtempSync(join(tmpdir(), "st-cfg-"));
    for (const d of ["ui", "tests"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
    cpSync(join(ROOT, "package.json"), join(dir, "package.json"));
    if (existsSync(join(ROOT, "node_modules"))) symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(join(dir, "ui/js/config.js"), `export const FEEDBACK_URL = ${JSON.stringify(v.url)};\nexport const FEEDBACK_VERSION_ENTRY = ${JSON.stringify(v.entry)};\n`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;                                   // 入れ子の node --test が、親の結果に混ざらないように
    const r = spawnSync(process.execPath, ["--test", ...AFFECTED], { cwd: dir, env, encoding: "utf8", timeout: 120000 });
    const failed = (r.stdout || "").split("\n").filter((l) => l.startsWith("not ok")).join("\n");
    assert.equal(r.status, 0, `失敗したテスト:\n${failed || (r.stderr || r.stdout || "").slice(-600)}`);
    assert.match(r.stdout, /# fail 0/);
  });
}
