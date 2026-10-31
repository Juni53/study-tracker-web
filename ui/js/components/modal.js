// Study Tracker v3 - ポップアップの開閉共通ヘルパー
// 背景(オーバーレイ)のクリックで閉じる挙動を、全タブで共通化する。

export function openModal(overlayEl) {
  overlayEl.classList.add("open");
}

export function closeModal(overlayEl) {
  overlayEl.classList.remove("open");
}

// overlayEl に一度だけ呼べば、以後そのポップアップは背景クリックで閉じるようになる。
export function bindBackdropClose(overlayEl) {
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeModal(overlayEl);
  });
}
