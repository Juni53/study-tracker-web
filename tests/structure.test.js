import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ui = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ui");
const read = (p) => fs.readFileSync(path.join(ui, p), "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const jsFiles = walk(path.join(ui, "js")).filter((f) => f.endsWith(".js"));

test("すべての JS が、ES モジュールとして文法的に正しい", () => {
  for (const f of jsFiles) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--input-type=module", "--check"], { input: fs.readFileSync(f) }), f);
  }
});

test("確認ダイアログは dialog.js に統一(画面ごとの専用の削除ポップアップ・OS の alert/confirm は無い)", () => {
  for (const f of jsFiles) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/id="delOverlay"|id="resetOverlay"|shDelText|shDelConfirm|delConfirmBtn|resetConfirmBtn/.test(src), `${path.basename(f)} に専用の確認ポップアップが残っている`);
    assert.ok(!/(^|[^.\w])(alert|confirm)\(/.test(src.replace(/\/\/.*$/gm, "")), `${path.basename(f)} が alert/confirm を使っている`);
  }
});

test("記録ログ: 日付の上マージンは日のグループ自身にあり、見出しには無い(追加・削除アニメーションで16pxずれる不具合の修正)", () => {
  const css = read("css/views.css");
  assert.match(css, /\.day-group\{[^}]*margin-top:16px/);
  const head = css.match(/\.day-head\{[^}]*\}/)[0];
  assert.ok(!/margin-top/.test(head), ".day-head に margin-top が残っている");
});

test("太字ぶんの幅の確保: .tbtn と .chip-t に data-text の複製があり、テンプレートが data-text を付けている", () => {
  const css = read("css/components.css");
  assert.match(css, /\.tbtn::after\{content:attr\(data-text\)/);
  assert.match(css, /\.chip-t::after\{content:attr\(data-text\)/);
  for (const f of ["js/views/log.js", "js/views/stats.js", "js/views/settings.js"]) {
    const src = read(f);
    const tags = src.match(/<button class="tbtn[^>]*>/g) || [];
    assert.ok(tags.length > 0, f);
    tags.forEach((t) => assert.match(t, /data-text=/, `${f}: ${t}`));
  }
});

test("枠のないボタンには、ホバーの背景も押したときの反応も無い(文字色のフェードだけ)", () => {
  const css = (read("css/components.css") + read("css/views.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  // ルールごとに見る(セレクタ { 宣言 })。枠のないボタンのクラスだけが対象
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const borderless = /\.(icon-btn|modal-close|sh-mark|exam-sameday-btn|st-detail-btn|guide-toggle|adv-toggle|pomo-chk-row)\b/;
  for (const r of rules.filter((x) => borderless.test(x.sel))) {
    if (/:hover/.test(r.sel)) assert.ok(!/background/.test(r.body), `${r.sel} にホバーの背景がある`);
    assert.ok(!/:active/.test(r.sel), `${r.sel} に押したときの反応がある`);
  }
  assert.ok(rules.some((r) => /^\.icon-btn$/.test(r.sel) && /transition:color/.test(r.body)));
});

test("押したときの縮み(scale)は使わない(枠ありのボタンのフラッシュだけ)", () => {
  const css = read("css/components.css");
  assert.ok(!/:active[^{]*\{[^}]*scale\(/.test(css));
});

test("横に伸び縮みするボタン行は、文字が折り返さない(縮む途中で縦に広がらない)", () => {
  assert.match(read("css/views.css"), /\.sw-btn-row > \*\{white-space:nowrap; flex:none;\}/);
});

test("ポモドーロの設定欄は4列と2列の2通りだけ(幅で切り替え)", () => {
  const css = read("css/views.css");
  assert.match(css, /\.pomo-cfg\{display:grid; grid-template-columns:repeat\(4, 1fr\)/);
  const cq = css.match(/@container \(max-width:\d+px\)\{ \.pomo-cfg\{grid-template-columns:repeat\(2, 1fr\);\} \}/g) || [];
  assert.equal(cq.length, 1);
});

test("タイマーのボタン行・サイドバーのタイマーは、毎秒 innerHTML で作り直さない", () => {
  const timer = read("js/views/timer.js");
  assert.ok(!/row\.innerHTML/.test(timer));
  const app = read("js/app.js");
  const paint = app.slice(app.indexOf("function paintFooter()"), app.indexOf("subscribe(paintFooter)"));
  assert.ok(!/innerHTML/.test(paint), "paintFooter が innerHTML を使っている");
});

test("ポモドーロ: 連動の切り替えは見出し(.pomo-head)に残し、それ以外の設定は折りたたみ(#pomoAdvContent)の中・いちばん下にある", () => {
  const src = read("js/views/timer.js");
  const head = src.slice(src.indexOf('<div class="pomo-head">'), src.indexOf('<div class="ring-area">'));
  assert.match(head, /id="pomoLinkRow"/);
  for (const id of ["pomoPauseRow", "cfgWork", "data-opt=\"sound\"", "pomoVolume", "data-chime", "data-opt=\"desktopNotify\"", "data-opt=\"idleInhibit\""]) {
    assert.ok(!head.includes(id), `${id} が見出しに残っている`);
  }
  const adv = src.slice(src.indexOf('id="pomoAdvContent"'));
  for (const id of ["pomoPauseRow", "cfgWork", "data-opt=\"sound\"", "pomoVolume", "data-chime=\"toBreak\"", "data-chime=\"toWork\"", "data-chime=\"toLong\"", "data-opt=\"desktopNotify\"", "data-opt=\"idleInhibit\""]) {
    assert.ok(adv.includes(id), `${id} が折りたたみの中に無い`);
  }
  assert.ok(src.indexOf('id="ringCircle"') < src.indexOf('id="pomoAdvToggle"'), "折りたたみがリングより下にある");
});

test("音・通知・アイドル阻害は、タブを開かなくても効くよう、起動時(app.js)に読み込み・開始している", () => {
  const app = read("js/app.js");
  assert.match(app, /startAlerts\(api\)/);
  assert.match(app, /loadPrefs\(api\)/);
});

test("休憩中はストップウォッチを一時停止: 連動OFFでも変更できる(薄くしない・クリックを弾かない)", () => {
  const src = read("js/views/timer.js");
  const handler = src.slice(src.indexOf('pauseRow.addEventListener("click"'), src.indexOf("// ── ストップウォッチ操作"));
  assert.ok(!/linked/.test(handler), "クリックの処理が連動モードを見ている");
  assert.ok(!/pomoPauseRow"\)\.style/.test(src), "行を薄くする/カーソルを変える処理が残っている");
});

test("休憩中はストップウォッチを一時停止: 連動モードのときだけ働くことを示す一文がある", () => {
  const src = read("js/views/timer.js");
  assert.match(src, /pomoPauseRow[\s\S]{0,400}pomo-opt-note">連動モードがONのときだけ働きます/);
});
