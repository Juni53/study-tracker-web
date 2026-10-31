import test from "node:test";
import assert from "node:assert/strict";
import { createTabGuard } from "../ui/js/core/tabGuard.js";
import { createFakeLocks } from "./_fakeLocks.js";

test("最初のタブはロックを取れる。2つ目は取れない", async () => {
  const locks = createFakeLocks();
  const a = createTabGuard({ locks }), b = createTabGuard({ locks });
  assert.deepEqual(await a.acquire(), { ok: true, supported: true });
  assert.deepEqual(await b.acquire(), { ok: false, supported: true });
  assert.equal(a.state, "held");
});

test("takeOver で奪うと、奪われた側に onLost が呼ばれる", async () => {
  const locks = createFakeLocks();
  let lost = 0;
  const a = createTabGuard({ locks, onLost: () => lost++ });
  const b = createTabGuard({ locks });
  await a.acquire();
  await b.takeOver();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(lost, 1);
  assert.equal(a.state, "lost");
  assert.equal(b.state, "held");
});

test("release すると、次のタブが取れる", async () => {
  const locks = createFakeLocks();
  const a = createTabGuard({ locks }), b = createTabGuard({ locks });
  await a.acquire();
  a.release();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await b.acquire()).ok, true);
});

test("Web Locks が使えない環境では、何もせず通す", async () => {
  const g = createTabGuard({ locks: null });
  assert.equal(g.supported, false);
  assert.deepEqual(await g.acquire(), { ok: true, supported: false });
  assert.equal(await g.takeOver(), true);
});
