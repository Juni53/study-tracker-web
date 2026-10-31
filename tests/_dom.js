// テスト用: jsdom を立ち上げて、UI のモジュール(document をグローバルとして使う)を動かせるようにする
import { JSDOM } from "jsdom";

export function setupDom(html = "<!DOCTYPE html><body></body>") {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.getComputedStyle = w.getComputedStyle.bind(w);
  for (const k of ["Event", "KeyboardEvent", "MouseEvent", "HTMLElement"]) globalThis[k] = w[k];
  return dom;
}

export const key = (k, opts = {}) => new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...opts });
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
