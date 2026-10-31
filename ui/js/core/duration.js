// 時間の文字列の読み取りと表示。Python 版 data_manager.parse_duration / fmt_time の移植。
//
// Python の float() / \d は全角数字(１２)も受け付けるので、それに合わせて全角 0-9 は半角にしてから読む。
// (アラビア数字など他の文字種の数字は、Python 版と違って受け付けない。)

import { floorDiv, pyStrip } from "./num.js";

const toAscii = (s) => s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));

// Python の float() が受け付ける書式(1_000 や inf / nan も含む)。受け付けないものは例外。
const D = "\\d+(?:_\\d+)*";
const FLOAT_RE = new RegExp(`^[+-]?(?:(?:${D})?\\.${D}|${D}\\.?)(?:[eE][+-]?${D})?$`);
const SPECIAL_RE = /^([+-]?)(inf|infinity|nan)$/i;

export function pyFloat(text) {
  const s = toAscii(pyStrip(text));
  const sp = SPECIAL_RE.exec(s);
  if (sp) return sp[2].toLowerCase() === "nan" ? NaN : sp[1] === "-" ? -Infinity : Infinity;
  if (!FLOAT_RE.test(s)) throw new Error(`数値として読めません: ${text}`);
  return Number(s.replaceAll("_", ""));
}

// Python の float(x) 相当: 数値・真偽値・文字列を受け付け、それ以外(null・配列など)は例外
export function toPyFloat(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return pyFloat(v);
  throw new TypeError(`数値に変換できません: ${v}`);
}

// Python の int(x) 相当(小数は 0 方向に切り捨て。"5.7" のような文字列は例外。無限大・NaN も例外)
export function pyInt(v) {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("整数に変換できません");
    return Math.trunc(v);
  }
  if (typeof v === "string") {
    const t = toAscii(pyStrip(v));
    if (!/^[+-]?\d+(?:_\d+)*$/.test(t)) throw new Error(`整数として読めません: ${v}`);
    return parseInt(t.replaceAll("_", ""), 10);
  }
  throw new TypeError(`整数に変換できません: ${v}`);
}

// "1h30m" "1.5h" "1:30" "90" など → 分(整数)。読めなければ例外。
export function parseDuration(text) {
  const t = toAscii(pyStrip(text));
  let m = /^(\d+(?:\.\d+)?)h(?:(\d+)m?)?$/i.exec(t);
  if (m) return Math.trunc(parseFloat(m[1]) * 60) + parseInt(m[2] || "0", 10);
  m = /^(\d+):(\d{1,2})$/.exec(t);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  const f = pyFloat(t);
  if (!Number.isFinite(f)) throw new Error(`時間として読めません: ${text}`);
  return Math.trunc(f);
}

// 分 → "1h05m" / "45m"
export function fmtTime(minutes) {
  const n = Math.trunc(minutes);
  const h = floorDiv(n, 60);
  const m = n - h * 60;
  return h ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}
