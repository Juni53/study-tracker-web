// 複数タブの同時起動の防止。Web Locks API で「いま使っているタブは1つだけ」にする。
//
// なぜ必要か: ブラウザでは同じアプリを複数のタブで開けてしまう。片方で記録を足し、
// もう片方(古い状態のまま)で別の操作をすると、古い状態で上書きして記録が消える。
//
// 流れ:
//  1. 起動時に acquire()。ロックが取れたら、このタブが「使用中のタブ」。
//  2. 取れなければ、別のタブが使用中。画面で「このタブで使う」を選んでもらい、takeOver() で奪う。
//  3. 奪われた側には onLost が呼ばれる。そのタブは操作できなくし、保存も止める。
//  ※ データの読み込みは、必ずロックを取ったあとに行うこと(奪った直後に最新のデータを読むため)。

export const LOCK_NAME = "study-tracker-primary";

export function createTabGuard({ locks = globalThis.navigator && globalThis.navigator.locks, onLost } = {}) {
  let state = "idle";            // idle | held | lost
  let release = null;

  function hold(options) {
    return new Promise((resolve) => {
      const held = new Promise((r) => { release = r; });
      const req = locks.request(LOCK_NAME, options, (lock) => {
        if (!lock) { resolve(false); return; }       // ifAvailable で、すでに誰かが持っていた
        state = "held";
        resolve(true);
        return held;                                  // release() されるまで持ち続ける
      });
      req.catch((e) => {
        if (e && e.name === "AbortError" && state === "held") { state = "lost"; if (onLost) onLost(); }
      });
    });
  }

  return {
    supported: !!locks,
    get state() { return state; },
    async acquire() {
      if (!locks) return { ok: true, supported: false };
      return { ok: await hold({ ifAvailable: true }), supported: true };
    },
    async takeOver() {
      if (!locks) return true;
      await hold({ steal: true });
      return true;
    },
    release() { if (release) { release(); release = null; } if (state === "held") state = "idle"; },
  };
}
