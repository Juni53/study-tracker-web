// 計測の途中の再読み込みの確認(components/leaveGuard.js)と、「計測の途中か」の判定(store/stopwatch.js の hasActiveSession)
import test from "node:test";
import assert from "node:assert/strict";
import { installLeaveGuard } from "../ui/js/components/leaveGuard.js";
import { stopwatch, hasActiveSession } from "../ui/js/store/stopwatch.js";

function fakeWin() {
  const ls = new Set();
  return { ls, addEventListener: (t, f) => { if (t === "beforeunload") ls.add(f); }, removeEventListener: (t, f) => { if (t === "beforeunload") ls.delete(f); } };
}
const fire = (win) => {
  const ev = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } };
  let ret;
  for (const f of win.ls) ret = f(ev);
  return { ev, ret };
};

test("計測の途中なら、離れる前にブラウザの確認を出させる(preventDefault と returnValue)/ 途中でなければ、何もしない", () => {
  const win = fakeWin();
  let active = false;
  installLeaveGuard({ isActive: () => active, win });
  let r = fire(win);
  assert.equal(r.ev.prevented, false);
  assert.equal(r.ev.returnValue, undefined);
  assert.equal(r.ret, undefined);
  active = true;
  r = fire(win);
  assert.equal(r.ev.prevented, true);
  assert.equal(r.ev.returnValue, "");
  assert.equal(r.ret, "");
  active = false;                                   // 計測が終われば、また何も出ない
  assert.equal(fire(win).ev.prevented, false);
});

test("installLeaveGuard が返す関数で、解除できる", () => {
  const win = fakeWin();
  const off = installLeaveGuard({ isActive: () => true, win });
  assert.equal(win.ls.size, 1);
  off();
  assert.equal(win.ls.size, 0);
  assert.equal(fire(win).ev.prevented, false);
});

test("hasActiveSession: 動いている・一時停止中で未保存・ポモドーロだけ動いている → true。保存/リセットのあとは false", () => {
  const clean = () => { stopwatch.reset(); stopwatch.pomodoroReset(); };
  clean();
  try {
    assert.equal(hasActiveSession(), false, "何もしていないのに、計測中");
    stopwatch.start();
    assert.equal(hasActiveSession(), true, "動いているのに、計測中でない");
    stopwatch.pause();
    assert.equal(stopwatch.running, false);
    assert.equal(hasActiveSession(), true, "一時停止中(未保存)は、計測が残っている");
    stopwatch.finishAndReset();                     // 保存のあと
    assert.equal(hasActiveSession(), false);

    stopwatch.pomodoroStart();
    assert.equal(hasActiveSession(), true, "ポモドーロだけが動いているとき");
    stopwatch.pomodoroReset();
    assert.equal(hasActiveSession(), false);
  } finally { clean(); }
});
