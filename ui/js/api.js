// Study Tracker (Web 版) - API の入口。
//
// 以前は、ここで pywebview(Python)を呼んでいた。Web 版では、同じメソッド名のまま、
// ブラウザ内の実装(core/localApi.js)を呼ぶ。views/ は、これまでどおり `api.メソッド名(...)` で呼べる。
//
// ・初回の呼び出し時に起動処理(core/boot.js)が走り、終わるまで呼び出しは待たされる。
// ・Python 版では pywebview が JSON で値を受け渡していたため、呼び出し側が戻り値を書き換えても
//   内部のデータには影響しなかった。同じ性質を保つため、引数と戻り値は複製して受け渡す。

import { bootApp } from "./core/boot.js";
import { bootUi } from "./core/bootUi.js";

let booted = null;
export function ready() {
  if (!booted) booted = bootApp({ ui: bootUi });
  return booted;
}

const copy = (v) => (v === undefined ? v : structuredClone(v));

export const api = new Proxy({}, {
  get(_, method) {
    if (typeof method !== "string" || method === "then") return undefined;
    return async (...args) => {
      const { api: impl } = await ready();
      if (typeof impl[method] !== "function") throw new Error(`api.${method} は存在しません`);
      return copy(await impl[method](...args.map(copy)));
    };
  },
});
