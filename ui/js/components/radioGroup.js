// 選択肢の組(ラジオボタンのように、どれか1つだけが選ばれるボタンの列)。
//
// 必ず「その組の入れ物(container)の中だけ」を対象にする。ページ内の別の組(同じ .tbtn を使う別の列)には、
// 選択状態も、処理も、及ばない。(以前、テーマの列の処理が、同じページの別の列のボタンまで巻き込んでいた。)
//
// onSelect(btn) は、選ばれていなかったボタンが押されたときだけ呼ぶ。すでに選ばれているボタンを押しても、何も起きない。
// 戻り値の setActive(判定関数) で、画面の描き直し時に、選択状態を合わせられる。
export function bindRadioGroup(container, onSelect, { itemSelector = ".tbtn", activeClass = "active" } = {}) {
  const items = () => [...container.querySelectorAll(itemSelector)];
  container.addEventListener("click", async (e) => {
    const btn = e.target.closest(itemSelector);
    if (!btn || !container.contains(btn)) return;
    if (btn.classList.contains(activeClass)) return;
    items().forEach((b) => b.classList.toggle(activeClass, b === btn));
    await onSelect(btn);
  });
  return { setActive: (isActive) => items().forEach((b) => b.classList.toggle(activeClass, !!isActive(b))) };
}
