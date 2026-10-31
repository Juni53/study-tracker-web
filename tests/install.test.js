import test from "node:test";
import assert from "node:assert/strict";

const l = {};
const fakeWin = {
  addEventListener: (t, f) => (l[t] ||= []).push(f),
  fire: (t, ev) => (l[t] || []).forEach((f) => f(ev)),
  navigator: { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130", platform: "Win32", maxTouchPoints: 0 },
  matchMedia: () => ({ matches: false }),
};
const { initInstall, canInstall, promptInstall, onInstallStateChange, isStandalone, isIos } = await import("../ui/js/components/install.js");
initInstall(fakeWin);

const promptEvent = (outcome) => {
  const e = { prevented: false, prompted: 0, preventDefault() { this.prevented = true; }, prompt() { this.prompted++; }, userChoice: Promise.resolve({ outcome }) };
  return e;
};

test("最初は、インストールできる状態ではない。promptInstall は unavailable", async () => {
  assert.equal(canInstall(), false);
  assert.deepEqual(await promptInstall(), { outcome: "unavailable" });
});

test("beforeinstallprompt を保持して(ブラウザ標準の案内は止める)、ボタンから案内を出せる。出したあとは、もう一度は出せない", async () => {
  let changes = 0;
  const off = onInstallStateChange(() => changes++);
  const ev = promptEvent("accepted");
  fakeWin.fire("beforeinstallprompt", ev);
  assert.equal(ev.prevented, true);
  assert.equal(canInstall(), true);
  assert.equal(changes, 1);
  assert.deepEqual(await promptInstall(), { outcome: "accepted" });
  assert.equal(ev.prompted, 1);
  assert.equal(canInstall(), false);
  assert.deepEqual(await promptInstall(), { outcome: "unavailable" });
  assert.equal(changes, 2);
  off();
});

test("案内を断った(dismissed)結果も返す / appinstalled で保持を捨てる", async () => {
  const ev = promptEvent("dismissed");
  fakeWin.fire("beforeinstallprompt", ev);
  assert.deepEqual(await promptInstall(), { outcome: "dismissed" });
  fakeWin.fire("beforeinstallprompt", promptEvent("accepted"));
  assert.equal(canInstall(), true);
  fakeWin.fire("appinstalled", {});
  assert.equal(canInstall(), false);
});

test("すでにアプリとして開いているか(display-mode: standalone / iOS の navigator.standalone)", () => {
  assert.equal(isStandalone({ matchMedia: () => ({ matches: true }), navigator: {} }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ matchMedia: () => ({ matches: false }), navigator: {} }), false);
  assert.equal(isStandalone({ navigator: {} }), false);
});

test("iPhone / iPad の判定(iPadOS がデスクトップ表示で Mac を名乗る場合も)", () => {
  assert.equal(isIos({ navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 } }), true);
  assert.equal(isIos({ navigator: { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", platform: "iPad", maxTouchPoints: 5 } }), true);
  assert.equal(isIos({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", platform: "MacIntel", maxTouchPoints: 5 } }), true);
  assert.equal(isIos({ navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", platform: "MacIntel", maxTouchPoints: 0 } }), false);
  assert.equal(isIos(fakeWin), false);
});
