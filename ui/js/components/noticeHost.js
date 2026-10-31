// 画面の右下に出す、小さなお知らせ(バックアップのリマインダー・更新のお知らせ)を縦に並べる入れ物。
// お知らせどうしが重ならないように、1つの入れ物(固定表示)の中に積む。
export function getNoticeHost(doc = document) {
  let host = doc.querySelector(".notice-host");
  if (!host) {
    host = doc.createElement("div");
    host.className = "notice-host";
    host.setAttribute("aria-live", "polite");
    doc.body.appendChild(host);
  }
  return host;
}
