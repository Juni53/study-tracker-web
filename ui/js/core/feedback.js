// フィードバックのリンクを作る(DOM には触らない。設定は config.js)。
//   feedbackLink() → { href, withVersion } か、null(= 設定されていない・使えない値。タブは出さない)
// ・URL は https:// だけ使う(空・http・javascript: ・scheme の無い値・読めない値は、設定されていないものとして扱う)。
// ・FEEDBACK_VERSION_ENTRY が "entry.数字" の形なら、そのパラメータに「アプリのバージョン」だけを入れる。
//   形が違えば、何も足さない(任意の名前のパラメータを、URL へ混ぜないため)。学習データは、どちらの場合も入らない。
import { FEEDBACK_URL, FEEDBACK_VERSION_ENTRY } from "../config.js";
import { appVersionText } from "./appInfo.js";
import { BUILD_ID } from "./buildInfo.js";

const ENTRY_RE = /^entry\.\d+$/;

export function parseFeedbackUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  let u;
  try { u = new URL(text); } catch { return null; }
  return u.protocol === "https:" && u.hostname ? u : null;
}

export function feedbackLink({ url = FEEDBACK_URL, versionEntry = FEEDBACK_VERSION_ENTRY, version = appVersionText(BUILD_ID) } = {}) {
  const u = parseFeedbackUrl(url);
  if (!u) return null;
  const entry = String(versionEntry ?? "").trim();
  let withVersion = false;
  if (ENTRY_RE.test(entry)) {
    if (!u.searchParams.has("usp")) u.searchParams.set("usp", "pp_url"); // 事前入力のリンクの印(Google フォームが付けるもの)
    u.searchParams.set(entry, version);
    withVersion = true;
  }
  return { href: u.toString(), withVersion, version: withVersion ? version : null };
}
