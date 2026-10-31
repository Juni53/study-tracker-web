// バックアップのリマインダー(画面の右下に出す小さなお知らせ)。起動時に1回、周期がたっていれば出す。
// 「バックアップを取る」で、設定ページと同じ保存を実行。「あとで」は、明日まで出さない。
// リマインダーを止める・周期を変えるのは、設定ページ(データ管理)。

import { getNoticeHost } from "./noticeHost.js";

export async function showBackupBannerIfDue(api, doc = document) {
  let st;
  try { st = await api.get_backup_status(); } catch { return null; }
  if (!st || !st.due) return null;
  return mountBackupBanner(api, st, doc);
}

export function mountBackupBanner(api, st, doc = document) {
  const el = doc.createElement("div");
  el.className = "backup-banner notice-card";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <div class="bb-text nt-text"></div>
    <div class="bb-sub nt-sub">データは、このブラウザの中にだけ保存されています。</div>
    <div class="bb-actions nt-actions">
      <button type="button" class="btn primary small" data-bb="now">バックアップを取る</button>
      <button type="button" class="btn muted small" data-bb="later">あとで</button>
    </div>`;
  const text = el.querySelector(".bb-text");
  const sub = el.querySelector(".bb-sub");
  const nowBtn = el.querySelector('[data-bb="now"]');
  const laterBtn = el.querySelector('[data-bb="later"]');
  text.textContent = st.days_since === null ? "まだバックアップを取っていません" : `最後のバックアップから ${st.days_since} 日たちました`;
  const close = () => el.remove();

  nowBtn.addEventListener("click", async () => {
    nowBtn.disabled = true;
    try {
      const r = await api.save_backup();
      if (r && r.cancelled) { nowBtn.disabled = false; return; }                // 保存先を選ばずに閉じた
      if (r && r.ok) {
        text.textContent = "バックアップを保存しました";
        sub.textContent = r.filename || "";
        el.querySelector(".bb-actions").remove();
        setTimeout(close, 3000);
      } else {
        sub.textContent = `保存できませんでした${r && r.error ? `(${r.error})` : ""}`;
        nowBtn.disabled = false;
      }
    } catch { sub.textContent = "保存できませんでした"; nowBtn.disabled = false; }
  });
  laterBtn.addEventListener("click", async () => {
    try { await api.snooze_backup_reminder(); } catch { /* 延期できなくても、閉じる */ }
    close();
  });
  getNoticeHost(doc).appendChild(el);
  return el;
}
