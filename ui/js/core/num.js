// Python の数値まわりの挙動を JS で再現する道具。
//
// 特に round(): Python は「偶数丸め」(round(62.5) = 62, round(0.125, 2) = 0.12)、
// JS の Math.round は「切り上げ」(Math.round(62.5) = 63)。進捗率などで結果が変わるので、
// Python 版と同じ結果になる pyRound を使うこと。
//
// 実装: Number#toFixed は、2進数の正確な値で四捨五入する(=Python と同じ)。違うのは
// 「ちょうど中間」のときだけ(JS は切り上げ、Python は偶数側)。そこだけ補正する。

export function pyRound(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const ax = Math.abs(x);
  const s = ax.toFixed(nd + 25);               // 正確な小数展開(ちょうど中間なら 5 のあとが 0 ばかりになる)
  const dot = s.indexOf(".");
  const tie = s.slice(dot + 1 + nd) === "5" + "0".repeat(24);
  let r;
  if (tie) {
    const kept = nd > 0 ? s.slice(0, dot + 1 + nd) : s.slice(0, dot);
    r = Number(kept.slice(-1)) % 2 === 0 ? Number(kept) : Number(ax.toFixed(nd));
  } else {
    r = Number(ax.toFixed(nd));
  }
  return r === 0 ? 0 : (neg ? -r : r);          // -0 は返さない(Python の整数 0 と揃える)
}

// Python の // と % (負の数でも床の向き。JS の % は 0 方向なので別物)
// 注意: 小数の // は、Math.floor(a / b) とは一致しないことがある(例: Python の 1 // 0.1 は 9、Math.floor(1 / 0.1) は 10)。
// CPython の float_divmod と同じ手順で計算する。b が 0 のときは呼ぶ側で除外すること。
export function floorDiv(a, b) {
  let mod = a % b;
  let div = (a - mod) / b;
  if (mod !== 0 && (b < 0) !== (mod < 0)) div -= 1.0;
  if (div === 0) return 0;
  const fl = Math.floor(div);
  return div - fl > 0.5 ? fl + 1.0 : fl;
}
export const floorMod = (a, b) => { const r = a % b; return r !== 0 && (r < 0) !== (b < 0) ? r + b : r; };
// Python の int(x) (0 方向への切り捨て)
export const intTrunc = (x) => Math.trunc(x);

// Python の str.strip()(引数なし)。JS の trim() とは取り除く文字が違う:
//   Python だけ取り除く: \x1c-\x1f, \x85    JS だけ取り除く: BOM(\ufeff)
// CSV の取り込みなど、Python 版と同じ結果にしたい箇所で使う。
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const PY_STRIP_RE = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "g");
export const pyStrip = (s) => String(s).replace(PY_STRIP_RE, "");
