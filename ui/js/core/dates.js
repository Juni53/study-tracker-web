// 日付の道具。Python 版の date.today() / date.fromisoformat() に相当する。
//
// 注意: Date#toISOString() は UTC 基準なので、日本では午前9時前に「前日」になる。
// このアプリの日付は、すべて「その端末の現地日付」で扱う。ここの関数だけを使うこと。
// 日付の足し引きは、暦(年月日)だけの計算にして、夏時間などの影響を受けないようにしている。

const pad2 = (n) => String(n).padStart(2, "0");

// テストで「今日」を固定するための時計
export const clock = { now: () => new Date() };
export function setClock(fn) {
  const prev = clock.now;
  clock.now = fn;
  return () => { clock.now = prev; };
}

export function isoOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export const todayIso = (now = clock.now()) => isoOf(now);
// Python の datetime.now().isoformat(timespec="seconds") 相当("2026-10-27T15:49:12"。タイムゾーン表記なし)
export const nowIsoSeconds = (now = clock.now()) => `${isoOf(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
export const nowHHMM = (now = clock.now()) => `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// "YYYY-MM-DD" を {y, m, d} にする。存在しない日付(2026-02-30 など)は例外。
export function parseIso(iso) {
  const m = typeof iso === "string" ? ISO_RE.exec(iso) : null;
  if (!m) throw new Error(`日付の形式が正しくありません: ${iso}`);
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) {
    throw new Error(`存在しない日付です: ${iso}`);
  }
  return { y, m: mo, d };
}
export const isValidIso = (iso) => { try { parseIso(iso); return true; } catch { return false; } };

const utcOf = (iso) => { const { y, m, d } = parseIso(iso); return Date.UTC(y, m - 1, d); };
const isoFromUtc = (t) => { const u = new Date(t); return `${u.getUTCFullYear()}-${pad2(u.getUTCMonth() + 1)}-${pad2(u.getUTCDate())}`; };

export const addDaysIso = (iso, n) => isoFromUtc(utcOf(iso) + n * 86400000);
// b - a (日数)。date(b) - date(a) と同じ。
export const daysBetween = (aIso, bIso) => Math.round((utcOf(bIso) - utcOf(aIso)) / 86400000);
// Python の date.weekday(): 月曜=0 … 日曜=6 (JS の getDay() は日曜=0 なので注意)
export const weekdayMon0 = (iso) => (new Date(utcOf(iso)).getUTCDay() + 6) % 7;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
