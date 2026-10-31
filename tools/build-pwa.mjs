// 公開用のビルド: ui/ を dist/ にコピーし、Service Worker(sw.js)に「保存するファイルの一覧」と「版」を書き込む。
//
// 使い方:  node tools/build-pwa.mjs [--dir ui] [--out dist]
//   ・ui/ そのものは変更しない(開発用のまま)。
//   ・版(BUILD_ID)は、全ファイルの中身から決める(同じ中身なら、何度ビルドしても同じ値。中身が変われば、別の値)。
//   ・ビルド後の dist/ を、ローカルで試すには:  python tools/serve.py --root dist
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["sw.js", ".DS_Store", "Thumbs.db"]);       // 保存の対象にしないもの(sw.js 自身は、ブラウザが別に取りに行く)
const GENERATED = "js/core/buildInfo.js";                         // 版の計算には含めない(版を書き込む先なので)

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, base));
    else if (!SKIP.has(name) && !name.endsWith(".map")) out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

// 全ファイル(パスと中身)から、12桁の版を決める
export function computeBuildId(dir, files) {
  const h = createHash("sha256");
  for (const f of files.filter((x) => x !== GENERATED).sort()) {
    h.update(f).update("\0").update(readFileSync(join(dir, f))).update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

// sw.js の中身の、版と一覧を書き換える
export function patchServiceWorker(source, buildId, precache) {
  const a = source.replace(/^const BUILD_ID = .*; \/\/ @build$/m, `const BUILD_ID = ${JSON.stringify(buildId)}; // @build`);
  const b = a.replace(/^const PRECACHE = .*; \/\/ @build$/m, `const PRECACHE = ${JSON.stringify(precache)}; // @build`);
  if (a === source || b === a) throw new Error("sw.js に、書き換える印(// @build)の行が見つかりません");
  return b;
}

export function build({ dir, out, builtAt = new Date().toISOString() }) {
  const src = resolve(dir), dst = resolve(out);
  if (dst === src || dst.startsWith(src + sep)) throw new Error("出力先は、入力のフォルダの外にしてください");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });

  const files = listFiles(dst);
  const buildId = computeBuildId(dst, files);
  writeFileSync(join(dst, GENERATED),
    `// (ビルドで生成)公開用のビルドの情報。\nexport const BUILD_ID = ${JSON.stringify(buildId)};\nexport const BUILT_AT = ${JSON.stringify(builtAt)};\n`);
  const swPath = join(dst, "sw.js");
  writeFileSync(swPath, patchServiceWorker(readFileSync(swPath, "utf8"), buildId, files));
  return { buildId, files };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };
  const { buildId, files } = build({ dir: arg("--dir", "ui"), out: arg("--out", "dist") });
  console.log(`ビルドしました: ${arg("--out", "dist")}/  版 ${buildId}  保存するファイル ${files.length} 個`);
}
