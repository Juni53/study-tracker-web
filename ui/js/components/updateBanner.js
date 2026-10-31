// 「新しいバージョンがあります」のお知らせ。「更新する」で、新しい版に切り替えて再読み込みする。
// 「あとで」は、この画面を開いている間だけ閉じる(次に開いたときに、また出る)。学習データは、更新しても変わらない。
import { getNoticeHost } from "./noticeHost.js";

export function showUpdateBanner(onApply, doc = document) {
  if (doc.querySelector(".update-banner")) return null;
  const el = doc.createElement("div");
  el.className = "update-banner notice-card";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <div class="nt-text">新しいバージョンがあります</div>
    <div class="nt-sub">更新すると、アプリを再読み込みします。記録は、そのまま残ります。</div>
    <div class="nt-actions">
      <button type="button" class="btn primary small" data-nt="apply">更新する</button>
      <button type="button" class="btn muted small" data-nt="later">あとで</button>
    </div>`;
  const apply = el.querySelector('[data-nt="apply"]');
  apply.addEventListener("click", async () => {
    apply.disabled = true;
    el.querySelector(".nt-text").textContent = "更新しています…";
    try { await onApply(); } catch { /* 切り替えに失敗したら、そのまま。下で、もう一度押せるようにする */ }
    setTimeout(() => { if (el.isConnected) { apply.disabled = false; el.querySelector(".nt-text").textContent = "新しいバージョンがあります"; } }, 4000);
  });
  el.querySelector('[data-nt="later"]').addEventListener("click", () => el.remove());
  getNoticeHost(doc).appendChild(el);
  return el;
}
