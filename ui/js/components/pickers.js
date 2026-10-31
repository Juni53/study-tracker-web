// Study Tracker v3 - タグ/試験チップの共通部品(充実度の★は components/stars.js)
// 記録ログの保存フォーム(ストップウォッチ側・手動追加側)の両方から使う。

const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// チップの名前の部分。data-text は、選択中の太字ぶんの幅を確保するための複製(components.css の .chip-t)
export const chipLabel = (name) => `<span class="chip-t" data-text="${escAttr(name)}">${escAttr(name)}</span>`;

export function tagChipsHtml(tags, selectedIds = []) {
  return tags
    .map(
      (t) => `<div class="chip${selectedIds.includes(t.id) ? " active" : ""}" data-kind="tag" data-id="${t.id}">
        <span class="sw" style="background:${t.color}"></span>${chipLabel(t.name)}
      </div>`
    )
    .join("");
}

export function examChipsHtml(exams, selectedIds = []) {
  if (!exams.length) return `<div class="empty-note">今後の試験はまだ登録されていません</div>`;
  return exams
    .map(
      (e) => `<div class="chip exam${selectedIds.includes(e.id) ? " active" : ""}" data-kind="exam" data-id="${e.id}">
        <span class="ex-flag">⚑</span>${chipLabel(e.name)} <span class="ex-date mono">${e.date.slice(5).replace("-", "/")}</span>
      </div>`
    )
    .join("");
}

// チップ(タグ/試験)のクリックで active をトグルする、共通のイベント委譲。
export function bindChipToggle(containerEl) {
  containerEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip || chip.classList.contains("locked")) return;
    chip.classList.toggle("active");
  });
}

export function selectedChipIds(scopeEl, kind) {
  return [...scopeEl.querySelectorAll(`.chip[data-kind="${kind}"].active`)].map((el) => parseInt(el.dataset.id, 10));
}
