// CSV の読み書き。Python 標準の csv モジュール(既定の設定)と同じ結果になるようにしてある。
// ・書き出し(csv.writer): 区切りは ","、必要なときだけ " で囲む(QUOTE_MINIMAL)、行末は \r\n。
// ・読み込み(csv.reader): 引用符で囲んだ欄の中の改行・"" の入れ子・空行([] になる)・最後の行に改行が無い場合、まで同じ。
// ・読み込み前の文字コード判定: UTF-8(BOM 付き可)で読めなければ cp932(Shift_JIS)。Excel で保存し直した CSV 対応。

export class CsvError extends Error {}

// ── 書き出し ──
const NEEDS_QUOTE = /[",\r\n]/;

export function csvField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

// 1行(末尾の \r\n つき)。Python の csv.writer は、欄が1つだけで空のときは "" と書く。
export function csvRow(values) {
  if (values.length === 1 && (values[0] === "" || values[0] === null || values[0] === undefined)) return '""\r\n';
  return values.map(csvField).join(",") + "\r\n";
}

// Python の str(float)。整数値でも 30.0 の形にする(Python 版のエクスポートと同じ見た目にするため)。
export const fmtPyFloat = (v) => (Number.isInteger(v) && Math.abs(v) < 1e16 ? `${v}.0` : String(v));

// ── 読み込み ──
// CPython の _csv.c(csv.reader)の状態遷移と同じ。行ごと(改行を含めて)に処理し、行の終わりに EOL を1回渡す。
const START_RECORD = 0, START_FIELD = 1, IN_FIELD = 2, IN_QUOTED_FIELD = 3, QUOTE_IN_QUOTED_FIELD = 4, EAT_CRNL = 5;
const EOL = -1;

export function parseCsv(text) {
  const rows = [];
  let fields = [], field = "", state = START_RECORD;
  const save = () => { fields.push(field); field = ""; };
  const step = (c) => {
    switch (state) {
      case START_RECORD:
        if (c === EOL) return;
        if (c === "\n" || c === "\r") { state = EAT_CRNL; return; }
        state = START_FIELD;
        // fallthrough
      case START_FIELD:
        if (c === "\n" || c === "\r" || c === EOL) { save(); state = c === EOL ? START_RECORD : EAT_CRNL; }
        else if (c === '"') state = IN_QUOTED_FIELD;
        else if (c === ",") save();
        else { field += c; state = IN_FIELD; }
        return;
      case IN_FIELD:
        if (c === "\n" || c === "\r" || c === EOL) { save(); state = c === EOL ? START_RECORD : EAT_CRNL; }
        else if (c === ",") { save(); state = START_FIELD; }
        else field += c;
        return;
      case IN_QUOTED_FIELD:
        if (c === EOL) return;
        if (c === '"') state = QUOTE_IN_QUOTED_FIELD;
        else field += c;
        return;
      case QUOTE_IN_QUOTED_FIELD:
        if (c === '"') { field += c; state = IN_QUOTED_FIELD; }
        else if (c === ",") { save(); state = START_FIELD; }
        else if (c === "\n" || c === "\r" || c === EOL) { save(); state = c === EOL ? START_RECORD : EAT_CRNL; }
        else { field += c; state = IN_FIELD; }
        return;
      case EAT_CRNL:
        if (c === "\n" || c === "\r") return;
        if (c === EOL) { state = START_RECORD; return; }
        throw new CsvError("改行の位置が不正です(欄の途中に改行があります)");
    }
  };
  for (const line of text.split(/(?<=\n)/)) {
    if (line === "") continue;
    for (const ch of line) step(ch);        // 1文字ずつ(サロゲートペアは1文字として扱う)
    step(EOL);
    if (state === START_RECORD) { rows.push(fields); fields = []; }
  }
  if (field !== "" || state === IN_QUOTED_FIELD) { save(); rows.push(fields); }   // 引用符が閉じないまま終わった場合も、そこまでを1行として返す
  return rows;
}

// バイト列 → 文字列。UTF-8(BOM 付き可)→ cp932 の順に試す。どちらでも読めなければ例外。
export function decodeCsvBytes(bytes) {
  for (const enc of ["utf-8", "shift_jis"]) {      // WHATWG の "shift_jis" は Windows-31J(cp932)
    try {
      const text = new TextDecoder(enc, { fatal: true, ignoreBOM: true }).decode(bytes);
      return enc === "utf-8" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    } catch { /* 次の文字コードを試す */ }
  }
  throw new CsvError("文字コードを判別できません(UTF-8 または Shift_JIS(cp932) の CSV に対応しています)");
}
