// Study Tracker v3 - ダイアログ(OS や WebView の alert / confirm の代わり)
// アプリの他のポップアップと同じ見た目・同じ動き(背景のフェード+本体の拡大縮小)で、HTML で表示する。
//   await showAlert("メッセージ");                       … OK を押すと閉じる
//   if (await showConfirm("メッセージ", { danger: true, okText: "削除する" })) { ... }   … OK なら true、取り消しなら false
// 削除の確認・全データのリセットなど、確認はすべてここを使う(画面ごとの専用ポップアップは持たない)。
// メッセージは文字列として表示する(HTML は解釈しない)。閉じたときに Promise はすぐに解決する(閉じるアニメーションの終了は待たない)。
//
// キーボードのルール:
//   通常      … 最初のフォーカスは OK。Enter で OK(進む)。
//   danger    … 最初のフォーカスは「キャンセル」。Enter はキャンセルになる。実行するには、OK をクリックするか、
//              Tab で OK へ移って Enter を押す。
//   Esc       … いつでもキャンセル。
//   Tab       … ダイアログの中だけを巡る(裏の画面へは出ない)。
//   フォーカス枠は表示しない。ただし Tab で移動したときだけ、枠ではなく薄い背景色で現在位置を示す
//   (オーバーレイに .kbd を付ける。見た目は components.css の .modal-overlay.dlg)。
//   Enter の押しっぱなし(キーリピート)は無視する(ダイアログを開いたキーの連打で、すぐ決定されないように)。

const CLOSE_MS = 450; // 閉じるアニメーション(約0.2秒)が終わってから要素を取り除く

function openDialog({ title, message, okText, cancelText, altText = null, danger }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay dlg";
    overlay.innerHTML = `
      <div class="modal-box${danger ? " danger" : ""}" role="dialog" aria-modal="true">
        <div class="modal-title"></div>
        <p class="dlg-message"></p>
        <div class="modal-actions">
          ${cancelText ? `<button type="button" class="btn muted" data-dlg="cancel"></button>` : ""}
          ${altText ? `<button type="button" class="btn muted" data-dlg="alt"></button>` : ""}
          <button type="button" class="btn ${danger ? "danger" : "primary"}" data-dlg="ok"></button>
        </div>
      </div>`;
    overlay.querySelector(".modal-title").textContent = title;
    overlay.querySelector(".dlg-message").textContent = message;
    const okBtn = overlay.querySelector('[data-dlg="ok"]');
    const cancelBtn = overlay.querySelector('[data-dlg="cancel"]');
    const altBtn = overlay.querySelector('[data-dlg="alt"]');
    if (altBtn) altBtn.textContent = altText;
    okBtn.textContent = okText;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    const buttons = [cancelBtn, altBtn, okBtn].filter(Boolean); // Tab の巡る順(左から)

    const prevFocus = document.activeElement;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), CLOSE_MS);
      // 開く前にフォーカスのあった要素へ戻す(まだ画面にあれば)
      if (prevFocus && prevFocus !== document.body && prevFocus.isConnected && typeof prevFocus.focus === "function") {
        prevFocus.focus({ preventScroll: true });
      }
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation();
        if (e.repeat) return;
        // フォーカスのあるボタンを押したことにする。ボタンにフォーカスが無いときは、通常は OK、danger はキャンセル
        const focused = buttons.find((b) => b === document.activeElement);
        if (focused) finish(focused.dataset.dlg === "alt" ? "alt" : focused.dataset.dlg === "ok");
        else finish(!danger);
      } else if (e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        overlay.classList.add("kbd"); // これ以降、フォーカス中のボタンに薄い背景色が付く
        const i = buttons.indexOf(document.activeElement);
        const next = e.shiftKey ? (i <= 0 ? buttons.length - 1 : i - 1) : (i < 0 || i === buttons.length - 1 ? 0 : i + 1);
        buttons[next].focus();
      }
    };
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
      const b = e.target.closest("[data-dlg]");
      if (b) finish(b.dataset.dlg === "alt" ? "alt" : b.dataset.dlg === "ok");
    });
    document.addEventListener("keydown", onKey, true);

    document.body.appendChild(overlay);
    void overlay.offsetWidth; // 閉じた状態を一度描画させてから open を付ける(付けないと遷移しない)
    overlay.classList.add("open");
    (danger && cancelBtn ? cancelBtn : okBtn).focus();
  });
}

export function showAlert(message, { title = "お知らせ", okText = "OK" } = {}) {
  return openDialog({ title, message, okText, cancelText: null, danger: false }).then(() => undefined);
}

export function showConfirm(message, { title = "確認", okText = "OK", cancelText = "キャンセル", danger = false } = {}) {
  return openDialog({ title, message, okText, cancelText, danger });
}

// 3つの選択肢(例: 上書き / 統合 / キャンセル)。"ok"(右端のボタン)・"alt"(真ん中)・null(取り消し)を返す。
// danger のときの扱いは showConfirm と同じ(最初のフォーカスと Enter はキャンセル)。
export function showChoice(message, { title = "確認", okText = "OK", altText, cancelText = "キャンセル", danger = false } = {}) {
  return openDialog({ title, message, okText, cancelText, altText, danger }).then((r) => (r === "alt" ? "alt" : r === true ? "ok" : null));
}
