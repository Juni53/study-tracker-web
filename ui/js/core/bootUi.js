// 起動時の警告の画面(DOM)。boot.js から差し込んで使う。
// 色は tokens.css の変数。確認ダイアログ等は、既存の dialog.js とは独立した、最小限の全画面表示。

function overlay(title, bodyHtml, buttons = []) {
  const el = document.createElement("div");
  el.setAttribute("role", "alertdialog");
  el.setAttribute("aria-modal", "true");
  el.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(var(--paper-rgb,243,241,233),.96);color:var(--ink,#22252B);padding:24px;";
  el.innerHTML =
    `<div style="max-width:420px;border:1px solid var(--line,#C4C8BE);background:var(--paper,#F3F1E9);padding:28px 28px 22px;">` +
    `<div style="font-weight:700;font-size:16px;margin-bottom:12px;">${title}</div>` +
    `<div style="font-size:13px;line-height:1.8;color:var(--ink-sub,#6B6558);margin-bottom:20px;">${bodyHtml}</div>` +
    `<div class="boot-btns" style="display:flex;gap:10px;justify-content:flex-end;"></div></div>`;
  const row = el.querySelector(".boot-btns");
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = `btn ${b.cls || ""}`;
    btn.textContent = b.label;
    btn.addEventListener("click", () => b.onClick(el, btn));
    row.appendChild(btn);
  }
  document.body.appendChild(el);
  return el;
}

export const bootUi = {
  // 別のタブが使用中。takeOver() が済むまで待つ Promise を返す。
  showBlocked(takeOver) {
    return new Promise((resolve) => {
      overlay(
        "別のタブで開かれています",
        "Study Tracker は、同時に複数のタブで使うと、記録が上書きされて消えることがあります。<br>" +
        "このタブで使う場合は、もう一方のタブは操作できなくなります。",
        [{
          label: "このタブで使う", cls: "primary",
          onClick: async (el, btn) => { btn.disabled = true; await takeOver(); el.remove(); resolve(); },
        }],
      );
    });
  },
  // 別のタブに引き継がれた。このタブは使えない(閉じてもらう)。
  showLost() {
    overlay(
      "別のタブに引き継がれました",
      "データを守るため、このタブでは操作も保存もできません。このタブを閉じてください。<br>" +
      "続けて使うには、ページを再読み込みしてください。",
      [{ label: "再読み込み", cls: "primary", onClick: () => location.reload() }],
    );
  },
  // IndexedDB が使えない環境
  showVolatile() {
    overlay(
      "この環境ではデータが保存されません",
      "ブラウザの設定(プライベートモードなど)により、データを保存できません。<br>" +
      "このまま使うこともできますが、タブを閉じると記録は消えます。",
      [{ label: "了解して続ける", cls: "muted", onClick: (el) => el.remove() }],
    );
  },
  // 保存の失敗(容量不足など)
  showSaveError() {
    if (document.getElementById("saveErrorBanner")) return;
    const b = document.createElement("div");
    b.id = "saveErrorBanner";
    b.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:9998;background:var(--stamp,#B23A2E);color:var(--paper,#F3F1E9);padding:8px 16px;font-size:12px;text-align:center;";
    b.textContent = "データを保存できませんでした。容量を確認するか、バックアップを取ってください。";
    document.body.appendChild(b);
  },
};
