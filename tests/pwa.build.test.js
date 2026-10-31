// 公開用のビルド(tools/build-pwa.mjs): 保存するファイルの一覧・版・元のフォルダを変えないこと。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, computeBuildId, patchServiceWorker } from "../tools/build-pwa.mjs";

const UI = new URL("../ui", import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), "st-pwa-"));
const swInfo = (dist) => {
  const src = readFileSync(join(dist, "sw.js"), "utf8");
  return {
    src,
    id: /^const BUILD_ID = "([^"]*)"; \/\/ @build$/m.exec(src)[1],
    precache: JSON.parse(/^const PRECACHE = (.*); \/\/ @build$/m.exec(src)[1]),
  };
};

test("ビルド: dist に、版と保存するファイルの一覧が書き込まれた sw.js ができる", () => {
  const out = join(tmp(), "dist");
  const { buildId, files } = build({ dir: UI, out });
  const sw = swInfo(out);
  assert.match(buildId, /^[0-9a-f]{12}$/);
  assert.equal(sw.id, buildId);
  assert.deepEqual(sw.precache, files);
  for (const must of ["index.html", "manifest.webmanifest", "css/tokens.css", "js/app.js", "js/api.js", "js/core/localApi.js",
                      "js/core/buildInfo.js", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"]) {
    assert.ok(sw.precache.includes(must), `${must} が保存の対象に入っていない`);
  }
  assert.ok(!sw.precache.includes("sw.js"), "sw.js 自身は保存しない");
  for (const f of sw.precache) assert.ok(existsSync(join(out, f)), `${f} が dist に無い`);
  const info = readFileSync(join(out, "js/core/buildInfo.js"), "utf8");
  assert.ok(info.includes(`BUILD_ID = "${buildId}"`));
  assert.match(info, /BUILT_AT = "\d{4}-\d{2}-\d{2}T/);
  rmSync(join(out, ".."), { recursive: true, force: true });
});

test("ビルド: 同じ中身なら同じ版(日時が違っても)。1文字でも変われば、別の版", () => {
  const root = tmp();
  const a = build({ dir: UI, out: join(root, "a"), builtAt: "2026-01-01T00:00:00Z" });
  const b = build({ dir: UI, out: join(root, "b"), builtAt: "2030-01-01T00:00:00Z" });
  assert.equal(a.buildId, b.buildId);

  const copy = join(root, "ui-copy");
  cpSync(UI, copy, { recursive: true });
  writeFileSync(join(copy, "js/app.js"), readFileSync(join(copy, "js/app.js"), "utf8") + "\n// 変更\n");
  assert.notEqual(build({ dir: copy, out: join(root, "c") }).buildId, a.buildId);

  const copy2 = join(root, "ui-copy2");
  cpSync(UI, copy2, { recursive: true });
  writeFileSync(join(copy2, "icons/icon-192.png"), Buffer.concat([readFileSync(join(copy2, "icons/icon-192.png")), Buffer.from([0])]));   // 画像の中身の変更も、版に反映される
  assert.notEqual(build({ dir: copy2, out: join(root, "d") }).buildId, a.buildId);
  rmSync(root, { recursive: true, force: true });
});

test("ビルド: 元の ui/ は変更しない(開発版のまま)", () => {
  const before = { sw: readFileSync(join(UI, "sw.js"), "utf8"), info: readFileSync(join(UI, "js/core/buildInfo.js"), "utf8") };
  const root = tmp();
  build({ dir: UI, out: join(root, "dist") });
  assert.equal(readFileSync(join(UI, "sw.js"), "utf8"), before.sw);
  assert.equal(readFileSync(join(UI, "js/core/buildInfo.js"), "utf8"), before.info);
  assert.match(before.sw, /^const BUILD_ID = "dev"; \/\/ @build$/m);
  assert.match(before.info, /BUILD_ID = "dev"/);
  rmSync(root, { recursive: true, force: true });
});

test("ビルド: 保存の対象にしないもの(.map・OS のごみ)は入らない / 出力先を入力の中にはできない / 印が無い sw.js は拒否", () => {
  const root = tmp();
  const copy = join(root, "ui");
  cpSync(UI, copy, { recursive: true });
  writeFileSync(join(copy, "js/x.js.map"), "{}");
  writeFileSync(join(copy, ".DS_Store"), "x");
  mkdirSync(join(copy, "sub"));
  writeFileSync(join(copy, "sub/.DS_Store"), "x");
  const { files } = build({ dir: copy, out: join(root, "dist") });
  assert.ok(!files.some((f) => f.endsWith(".map") || f.endsWith(".DS_Store")));
  assert.throws(() => build({ dir: copy, out: join(copy, "dist") }), /出力先は/);
  assert.throws(() => patchServiceWorker("const BUILD_ID = 1;\nconst PRECACHE = [];\n", "x", []), /印/);
  assert.equal(patchServiceWorker('const BUILD_ID = "dev"; // @build\nconst PRECACHE = []; // @build\n', "abc", ["a.js"]),
    'const BUILD_ID = "abc"; // @build\nconst PRECACHE = ["a.js"]; // @build\n');
  rmSync(root, { recursive: true, force: true });
});

test("版の計算は、buildInfo.js(版の書き込み先)を含めない", () => {
  const root = tmp();
  const copy = join(root, "ui");
  cpSync(UI, copy, { recursive: true });
  const files = ["index.html", "js/core/buildInfo.js"];
  const id1 = computeBuildId(copy, files);
  writeFileSync(join(copy, "js/core/buildInfo.js"), "// 別の中身\n");
  assert.equal(computeBuildId(copy, files), id1);
  rmSync(root, { recursive: true, force: true });
});
