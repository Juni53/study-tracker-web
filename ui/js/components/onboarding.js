// 初回起動時の案内(「はじめに」)。データの保存場所・バックアップ・インストール・端末の移し方・プライバシーを、1枚のポップアップで伝える。
//   await showOnboardingIfFirst(api, { onOpenBackup })   … まだ見ていなければ出す。閉じたら解決する(出さなかったときは null)
//   await showOnboarding(api, { first: false })           … 設定ページから、いつでも見直せる(見たことの記録は変えない)
// 「見たか」の印は、閉じたとき(ボタン・×・Esc のどれでも)に api.complete_onboarding() で付ける(メタ情報。localApi.js を参照)。
// 閉じる前にページを閉じたときは、印が付かないので、次の起動でもう一度出る。
//
// 長い内容なので、上(タイトル)と下(ボタン)は固定して、真ん中だけがスクロールする。
// 背景(ポップアップの外)を押しても閉じない(うっかり閉じて、読み損ねないように)。閉じるのは、ボタン・×・Esc。
// キーボードは dialog.js と同じ: Tab はポップアップの中だけを巡る。Enter の押しっぱなしは無視する(開いたキーの連打で、すぐ閉じないように)。

import { canInstall, promptInstall, isStandalone, installHowTo, onInstallStateChange } from "./install.js";

const CLOSE_MS = 450; // 閉じるアニメーション(約0.2秒)が終わってから要素を取り除く

export async function showOnboardingIfFirst(api, opts = {}) {
  let st;
  try { st = await api.get_onboarding(); } catch { return null; } // 状態が分からなければ、出さない(アプリは使える)
  if (!st || st.done || st.volatile) return null; // 見た後 / 保存できない環境(その警告が出ている。案内の「保存されます」が事実と違う)は、出さない
  return showOnboarding(api, { ...opts, first: true });
}

export function showOnboarding(api, { first = false, onOpenBackup = null, doc = document } = {}) {
  return new Promise((resolve) => {
    const overlay = doc.createElement("div");
    overlay.className = "modal-overlay dlg onb-overlay";
    overlay.innerHTML = `
      <div class="modal-box onb" role="dialog" aria-modal="true" aria-labelledby="onbTitle">
        <div class="onb-head">
          <div class="modal-title" id="onbTitle">はじめに</div>
          <div class="onb-lead">${first ? "Study Tracker へようこそ。使い始める前に、知っておいてほしいことをまとめました。" : "使い方の案内です。"}</div>
          <button type="button" class="modal-close" data-onb="close" aria-label="閉じる">✕</button>
        </div>
        <div class="onb-body">
          <section class="onb-sec" data-onb-sec="storage">
            <h3 class="onb-h">データの保存場所</h3>
            <div class="onb-t">記録・ポイント・設定は、いま使っている<b>このブラウザの中</b>にだけ保存されます。別の端末や、別のブラウザとは共有されません。ブラウザの「サイトデータ」を削除すると、記録も消えます。</div>
          </section>
          <section class="onb-sec" data-onb-sec="backup">
            <h3 class="onb-h">バックアップのお願い</h3>
            <div class="onb-t">万一のために、<b>定期的にバックアップ</b>を取ってください。設定ページの「データ管理」から、ボタン1つで保存できます。取りどきは、リマインダー(はじめは毎週。周期は変えられます)でお知らせします。</div>
            <div class="onb-act"><button type="button" class="btn muted small" data-onb="backup">データ管理を開く</button></div>
          </section>
          <section class="onb-sec" data-onb-sec="install">
            <h3 class="onb-h">アプリとして使う(インストール)</h3>
            <div class="onb-t"><span data-onb="installLead">インストールすると、デスクトップやホーム画面から、アプリのように開けます(オフラインでも使えます)。</span> <span data-onb="installHow"></span></div>
            <div class="onb-act" data-onb="installAct" hidden><button type="button" class="btn muted small" data-onb="install">アプリとしてインストール</button></div>
          </section>
          <section class="onb-sec" data-onb-sec="move">
            <h3 class="onb-h">端末を移るとき</h3>
            <ol class="onb-t onb-steps">
              <li>これまでの端末で、設定の「バックアップを保存」を押します。</li>
              <li>保存したファイルを、新しい端末へ送ります(メールやクラウドなど)。</li>
              <li>新しい端末で、このアプリを開き、設定の「バックアップから復元」を押します。</li>
            </ol>
          </section>
          <section class="onb-sec" data-onb-sec="privacy">
            <h3 class="onb-h">プライバシー</h3>
            <div class="onb-t">記録や設定は、外部のサーバーへ送られません。すべて、この端末の中で処理されます。アプリの新しい版を確認するために、このサイトへ接続することはありますが、記録は含まれません。</div>
          </section>
        </div>
        <div class="onb-foot">
          <button type="button" class="btn primary" data-onb="done">${first ? "はじめる" : "閉じる"}</button>
        </div>
      </div>`;

    const q = (sel) => overlay.querySelector(sel);
    const doneBtn = q('[data-onb="done"]');

    // ── インストールの項目: インストール済みなら出さない / 合図があればボタン / 無ければ手順の文 ──
    const installSec = q('[data-onb-sec="install"]');
    const installAct = q('[data-onb="installAct"]');
    function paintInstall() {
      if (!installSec.isConnected) return;
      if (isStandalone()) { installSec.hidden = true; return; } // すでにアプリとして開いている
      installSec.hidden = false;
      const ready = canInstall();
      installAct.hidden = !ready;
      q('[data-onb="installHow"]').textContent = ready ? "" : installHowTo();
    }
    const unsubInstall = onInstallStateChange(paintInstall);
    q('[data-onb="install"]').addEventListener("click", async () => { await promptInstall(); paintInstall(); });

    const prevFocus = doc.activeElement;
    let closed = false;
    const finish = (afterClose = null) => {
      if (closed) return;
      closed = true;
      doc.removeEventListener("keydown", onKey, true);
      unsubInstall();
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), CLOSE_MS);
      if (prevFocus && prevFocus !== doc.body && prevFocus.isConnected && typeof prevFocus.focus === "function") {
        prevFocus.focus({ preventScroll: true });
      }
      // 初回だけ「見た」印を付ける(次の afterClose より前に呼ぶ。印が付けられなくても、案内は閉じる)
      if (first) { try { Promise.resolve(api.complete_onboarding()).catch(() => {}); } catch { /* 印が付かなければ、次の起動でもう一度出るだけ */ } }
      resolve();
      if (afterClose) afterClose();
    };

    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        finish();
      } else if (e.key === "Enter") {
        if (e.repeat) { e.preventDefault(); e.stopPropagation(); } // 押しっぱなしの連打は無視。通常の Enter は、フォーカス中のボタンがそのまま押される
      } else if (e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        overlay.classList.add("kbd"); // これ以降、フォーカス中のボタンに薄い背景色が付く
        const btns = [...overlay.querySelectorAll("button")].filter((b) => !b.disabled && !b.closest("[hidden]"));
        const i = btns.indexOf(doc.activeElement);
        const next = e.shiftKey ? (i <= 0 ? btns.length - 1 : i - 1) : (i < 0 || i === btns.length - 1 ? 0 : i + 1);
        btns[next].focus();
      }
    };

    overlay.addEventListener("click", (e) => {
      const b = e.target.closest("[data-onb]");
      if (!b) return;
      if (b.dataset.onb === "close" || b.dataset.onb === "done") finish();
      else if (b.dataset.onb === "backup") finish(typeof onOpenBackup === "function" ? onOpenBackup : null);
    });
    doc.addEventListener("keydown", onKey, true);

    doc.body.appendChild(overlay);
    paintInstall();
    void overlay.offsetWidth; // 閉じた状態を一度描画させてから open を付ける(付けないと遷移しない)
    overlay.classList.add("open");
    doneBtn.focus({ preventScroll: true }); // 長いので、フォーカスで下までスクロールしないようにする
  });
}
