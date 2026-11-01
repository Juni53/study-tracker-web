// Study Tracker v3 - フィードバックタブ(フォームの URL が設定されているときだけ、ナビに出る。config.js / core/feedback.js)
// 3つ目の引数 { link } は、テスト用(ナビからは、渡さずに呼ばれる)。

import { feedbackLink } from "../core/feedback.js";

export function onLeave() {}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

export async function render(root, api, { link = feedbackLink() } = {}) {
  const body = link
    ? `<div class="sect">
        <div class="sect-lbl">ご意見・ご要望をお寄せください</div>
        <div class="fb-text">Study Tracker を使ってみて、気づいたこと・うまく動かないところ・ほしい機能があれば、フォームから教えてください。不具合は、使っている端末とブラウザ(例: iPad の Safari)も書いてもらえると、直しやすくなります。</div>
        <div class="fb-act"><a class="btn primary fb-link" id="fbLink" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">フィードバックのフォームを開く</a></div>
        <div class="fb-note">フォームは、別のページ(外部のサービス)で開きます。${link.withVersion
          ? `開くと、アプリのバージョン(${esc(link.version)})だけが、フォームに入力された状態になります。`
          : ""}記録や設定は、送られません。</div>
      </div>`
    : `<div class="sect"><div class="empty-note">フィードバックの宛先が設定されていません。</div></div>`;
  root.innerHTML = `<div class="top"><h1>フィードバック</h1></div>${body}`;
}
