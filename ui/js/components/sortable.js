// Study Tracker v3 - ドラッグ&ドロップの並び替え(縦に並んだ一覧用)
//
//  ・行の先頭の「=」(ハンドル)を掴んで動かす。掴んだ行は、カーソルについて動く。
//  ・ドラッグ中は、カーソルの位置に基づいて「ここに入る」という場所を、赤い線で示す。
//  ・離すと、その場所へ滑らかにスライドして入れ替わる(ほかの行も、新しい位置へ滑らかに動く)。
//  ・キーボードでも並び替えられる(ハンドルにフォーカスして ↑ / ↓。Esc でドラッグを取り消し)。
//
// 使い方(コンテナは、並べ替えのあとに中身を描き直しても残る要素にする。イベントは委譲で受ける):
//   makeSortable(listEl, {
//     itemSel: ".sort-item",          // 行。data-sort-key="キー" と、滑らかな移動用の data-flip を付けておく
//     handleSel: ".sort-handle",      // 掴む場所
//     range: (others, dragged) => [min, max],   // (省略可)入れられる位置の範囲。others = 掴んだ行を除いた行の配列
//     flipRoots: [rootEl, ...],       // 滑らかな移動の対象(data-flip を持つ要素を含む親)
//     commit: (orderedKeys, movedKey) => {...},  // 同期で、並びを更新して描き直す(この直後に滑らかな移動を再生する)
//     persist: async (orderedKeys) => {...},     // (省略可)保存。commit のあとに呼ぶ
//   });

import { captureRects, playFlip, EASE_OUT, reduceMotion } from "./motion.js";

export function makeSortable(container, { itemSel, handleSel, range = null, flipRoots = [], commit, persist = null }) {
  container.classList.add("sort-list"); // 並び先を示す線を、コンテナの中で絶対配置するため
  const keyOf = (el) => el.dataset.sortKey;
  const itemsOf = () => [...container.querySelectorAll(itemSel)];
  let drag = null; // ドラッグ中の状態

  // 掴んだ行を除いた並びの中で、「どこに入るか」(0〜others.length)を、カーソルの縦位置から決める。
  // 範囲(range)があれば、その範囲に収める(例: お気に入りと通常の境界を越えない)。
  function insertionIndex(others, dragged, cursorY) {
    let idx = others.filter((o) => {
      const r = o.getBoundingClientRect();
      return r.top + r.height / 2 < cursorY;
    }).length;
    if (range) {
      const [min, max] = range(others, dragged);
      idx = Math.max(min, Math.min(max, idx));
    }
    return idx;
  }

  function orderedKeys(others, dragged, idx) {
    const keys = others.map(keyOf);
    keys.splice(idx, 0, keyOf(dragged));
    return keys;
  }

  // 並びを確定する(ドラッグでもキーボードでも共通): いまの位置を記録 → 並びを更新して描き直す → 元の位置から滑らかに動かす → 保存
  async function applyOrder(keys, movedKey, afterCommit = null) {
    const firsts = flipRoots.map((r) => captureRects(r));
    commit(keys, movedKey);
    flipRoots.forEach((r, i) => playFlip(r, firsts[i]));
    if (afterCommit) afterCommit(); // 保存の完了は待たずに、描き直した直後に呼ぶ
    if (persist) {
      try { await persist(keys); } catch (e) { console.error("並び順の保存に失敗しました", e); }
    }
  }

  function showIndicator(others, idx) {
    const cr = container.getBoundingClientRect();
    let y;
    if (!others.length) y = 0;
    else if (idx < others.length) y = others[idx].getBoundingClientRect().top - cr.top;
    else y = others[others.length - 1].getBoundingClientRect().bottom - cr.top;
    drag.indicator.style.display = "block";
    drag.indicator.style.top = `${y - 1}px`;
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    drag.item.style.transform = `translateY(${dy}px)`;
    drag.idx = insertionIndex(drag.others, drag.item, e.clientY);
    showIndicator(drag.others, drag.idx);
  }

  function cleanup() {
    if (!drag) return;
    drag.item.classList.remove("sort-dragging");
    container.classList.remove("sort-active");
    drag.indicator.remove();
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKey, true);
    drag = null;
  }

  // 離した: 場所が変わっていれば、その場所へ滑らかにスライドして入れ替わる。変わっていなければ、元の場所へ戻る
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { item, others, idx, originalIdx } = drag;
    const keys = orderedKeys(others, item, idx);
    const moved = idx !== originalIdx;
    if (moved) {
      // 掴んだ行は、離した位置(transform が付いたまま)の座標を「元の位置」として記録するので、transform は外さずに渡す
      const finalKeys = keys, movedKey = keyOf(item);
      cleanup();
      applyOrder(finalKeys, movedKey);
    } else {
      const from = item.style.transform;
      cleanup();
      item.style.transform = "";
      if (!reduceMotion() && typeof item.animate === "function") {
        item.animate([{ transform: from }, { transform: "translateY(0)" }], { duration: 260, easing: EASE_OUT });
      }
    }
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const item = drag.item;
    cleanup();
    item.style.transform = "";
  }

  function onKey(e) {
    if (e.key === "Escape" && drag) { e.preventDefault(); e.stopPropagation(); const item = drag.item; cleanup(); item.style.transform = ""; }
  }

  container.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(handleSel);
    if (!handle || drag || (e.button !== undefined && e.button !== 0)) return;
    const item = handle.closest(itemSel);
    if (!item) return;
    e.preventDefault();
    const items = itemsOf();
    const others = items.filter((x) => x !== item);
    const indicator = document.createElement("div");
    indicator.className = "sort-indicator";
    container.appendChild(indicator);
    drag = { item, others, indicator, pointerId: e.pointerId, startY: e.clientY, originalIdx: items.indexOf(item), idx: items.indexOf(item) };
    item.classList.add("sort-dragging");
    container.classList.add("sort-active");
    if (handle.setPointerCapture) { try { handle.setPointerCapture(e.pointerId); } catch { /* 捕捉できなくても、document で受けるので動く */ } }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onKey, true);
    showIndicator(others, drag.idx);
  });

  // キーボード: ハンドルにフォーカスして ↑ / ↓ で1つずつ動かす(範囲の外には出ない)
  container.addEventListener("keydown", (e) => {
    if (drag || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const handle = e.target.closest(handleSel);
    if (!handle) return;
    const item = handle.closest(itemSel);
    if (!item) return;
    e.preventDefault();
    const items = itemsOf();
    const others = items.filter((x) => x !== item);
    const from = items.indexOf(item);
    let idx = from + (e.key === "ArrowUp" ? -1 : 1);
    if (range) { const [min, max] = range(others, item); idx = Math.max(min, Math.min(max, idx)); }
    idx = Math.max(0, Math.min(others.length, idx));
    if (idx === from) return;
    const key = keyOf(item);
    applyOrder(orderedKeys(others, item, idx), key, () => {
      // 描き直されたので、動かした行のハンドルにフォーカスを戻す(続けて動かせるように)
      const again = [...container.querySelectorAll(itemSel)].find((x) => keyOf(x) === key);
      const h = again && again.querySelector(handleSel);
      if (h) h.focus();
    });
  });
}
