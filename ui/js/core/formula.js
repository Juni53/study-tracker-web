// 換算式の評価。Python 版 data_manager.eval_formula の移植。
//
// Python 版は eval() で評価していたが、JS では eval / new Function を使わず、小さな式パーサを自作している。
// 理由: バックアップや共有されたデータに入っている式をそのまま実行すると、他人の書いたコードが
//       アプリの中で動いてしまうため(式として許すのは「数式」だけにする)。
//
// 使える構文(Python 版と同じ):
//   数値(1, 1.5, .5, 1e3, 1_000)、変数、( )、単項 + -、二項 + - * / // % ** と ^(= **)、
//   関数 floor(x) ceil(x) sqrt(x) log(x) log(x, base) pow(a, b)
// 使えない(Python 版では動くが、式として想定していないもの): 0x10 や 1j などの別形式の数値、
//   True/False、比較・条件式・リストなど。これらは「式が不正」として fallback になる。
//
// Python 版との意図的な違い: 結果が無限大になる式(1e308 * 10 など)は、Python 版は inf を返してしまうが、
//   JS 版は fallback にする(ポイントのデータを壊さないため)。

import { pyRound, floorDiv } from "./num.js";

class FormulaError extends Error {}
const fail = (msg) => { throw new FormulaError(msg); };

const NUM_RE = /^(?:\d+(?:_\d+)*(?:\.(?:\d+(?:_\d+)*)?)?|\.\d+(?:_\d+)*)(?:[eE][+-]?\d+(?:_\d+)*)?/;
const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = NUM_RE.exec(rest))) { toks.push({ t: "num", v: Number(m[0].replaceAll("_", "")) }); i += m[0].length; continue; }
    if ((m = ID_RE.exec(rest))) { toks.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    if (rest.startsWith("**")) { toks.push({ t: "op", v: "**" }); i += 2; continue; }
    if (rest.startsWith("//")) { toks.push({ t: "op", v: "//" }); i += 2; continue; }
    if (c === "^") { toks.push({ t: "op", v: "**" }); i++; continue; }
    if ("+-*/%(),".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    fail(`使えない文字です: ${c}`);
  }
  return toks;
}

const needFinite = (x) => { if (!Number.isFinite(x)) fail("計算できない値です"); return x; };
const div = (a, b) => { if (b === 0) fail("0で割れません"); return a / b; };
const floordiv = (a, b) => { if (b === 0) fail("0で割れません"); return floorDiv(a, b); };
const mod = (a, b) => { if (b === 0) fail("0で割れません"); const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; };
const pow = (a, b) => {
  if (a === 0 && b < 0) fail("0 を負の数で累乗できません");
  return needFinite(Math.pow(a, b));            // 負の数の小数乗は NaN → 不正(Python では複素数になり float() で失敗)
};

const FUNCS = {
  floor: { min: 1, max: 1, f: (x) => Math.floor(needFinite(x)) },
  ceil: { min: 1, max: 1, f: (x) => Math.ceil(needFinite(x)) },
  sqrt: { min: 1, max: 1, f: (x) => { if (x < 0) fail("負の数の平方根"); return Math.sqrt(needFinite(x)); } },
  log: {
    min: 1, max: 2,
    f: (x, base) => {
      if (!(x > 0)) fail("log の引数は正の数");
      if (base === undefined) return Math.log(x);
      if (!(base > 0)) fail("log の底は正の数");
      const den = Math.log(base);
      if (den === 0) fail("log の底が 1");
      return Math.log(x) / den;
    },
  },
  pow: { min: 2, max: 2, f: pow },
};
const isFunc = (name) => Object.prototype.hasOwnProperty.call(FUNCS, name);

function evaluate(src, vars) {
  const toks = tokenize(src);
  let p = 0;
  const isOp = (v) => toks[p] !== undefined && toks[p].t === "op" && toks[p].v === v;

  // 優先順位は Python と同じ: ** は単項マイナスより強く、右結合(2**3**2 = 2**9, -2**2 = -4, 2**-1 = 0.5)
  function expr() {
    let v = term();
    while (isOp("+") || isOp("-")) { const op = toks[p++].v; const r = term(); v = op === "+" ? v + r : v - r; }
    return v;
  }
  function term() {
    let v = factor();
    while (isOp("*") || isOp("/") || isOp("//") || isOp("%")) {
      const op = toks[p++].v; const r = factor();
      v = op === "*" ? v * r : op === "/" ? div(v, r) : op === "//" ? floordiv(v, r) : mod(v, r);
    }
    return v;
  }
  function factor() {
    if (isOp("+")) { p++; return factor(); }
    if (isOp("-")) { p++; return -factor(); }
    return power();
  }
  function power() {
    const base = atom();
    if (isOp("**")) { p++; return pow(base, factor()); }
    return base;
  }
  function atom() {
    const t = toks[p++];
    if (!t) fail("式が途中で終わっています");
    if (t.t === "num") return t.v;
    if (t.t === "op" && t.v === "(") { const v = expr(); if (!isOp(")")) fail("閉じかっこがありません"); p++; return v; }
    if (t.t === "id") {
      if (isOp("(")) {
        if (!isFunc(t.v)) fail(`関数ではありません: ${t.v}`);
        p++;
        const args = [];
        while (!isOp(")")) {
          args.push(expr());
          if (isOp(",")) p++; else break;       // 末尾のカンマも Python と同じく許す
        }
        if (!isOp(")")) fail("閉じかっこがありません");
        p++;
        const fn = FUNCS[t.v];
        if (args.length < fn.min || args.length > fn.max) fail(`${t.v} の引数の数が違います`);
        return fn.f(...args);
      }
      if (Object.prototype.hasOwnProperty.call(vars, t.v)) return Number(vars[t.v]);
      fail(`未定義の名前です: ${t.v}`);
    }
    fail(`予期しない記号です: ${t.v}`);
  }

  const v = expr();
  if (p !== toks.length) fail("式の後ろに余計なものがあります");
  return v;
}

// 式を評価して 0 以上の数を返す。式が不正・計算できない場合は fallback。
export function evalFormula(formula, variables, fallback = 0.0) {
  if (typeof formula !== "string") return fallback;
  try {
    const r = evaluate(formula, variables);
    if (!Number.isFinite(r)) return fallback;
    return Math.max(0, r);
  } catch (e) {
    if (e instanceof FormulaError) return fallback;
    throw e;
  }
}

export function calcBasePoints(minutes, formula) {
  return evalFormula(formula, { minutes, hour: minutes / 60 }, Math.floor(minutes / 60 * 5));
}

// 手動入力のポイント。[手動ポイント, 基本ポイント] を返す。
export function calcManualPoints(minutes, basePointFormula, manualFormula) {
  const base = calcBasePoints(minutes, basePointFormula);
  const manual = evalFormula(manualFormula, { points: base }, pyRound(base * 0.75, 2));
  return [manual, base];
}
