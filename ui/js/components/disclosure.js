// Study Tracker v3 - 折りたたみ(トグルと中身)。設定タブ・ポモドーロの設定で共通。
// toggle に .open を付け外しし、content は展開(expandIn)/折りたたみ(collapseOut)のアニメーションで開閉する。
import { expandIn, collapseOut, finished } from "./motion.js";

export function bindDisclosure(toggle, content, onOpen) {
  let anim = null, seq = 0;
  toggle.addEventListener("click", async () => {
    const mySeq = ++seq;
    const opening = !toggle.classList.contains("open");
    toggle.classList.toggle("open", opening);
    if (anim) { anim.cancel(); anim = null; }
    if (opening) {
      content.classList.add("open");
      if (onOpen) onOpen();
      expandIn(content);
    } else {
      anim = collapseOut(content);
      await finished(anim);
      if (mySeq !== seq) return; // 閉じている途中で、また開かれた
      content.classList.remove("open");
      if (anim) { anim.cancel(); anim = null; }
    }
  });
}
