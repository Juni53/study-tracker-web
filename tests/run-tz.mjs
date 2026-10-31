// いくつかのタイムゾーンで、全テストを実行する(日付まわりの不具合は、タイムゾーンによって出方が変わるため)。
// 使い方: npm run test:tz
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const files = readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".test.js")).map((f) => `tests/${f}`);
let failed = false;
for (const tz of ["Asia/Tokyo", "America/Los_Angeles", "Pacific/Auckland", "UTC"]) {
  const r = spawnSync(process.execPath, ["--test", ...files], { env: { ...process.env, TZ: tz }, encoding: "utf8" });
  const pass = /# pass (\d+)/.exec(r.stdout)?.[1], fail = /# fail (\d+)/.exec(r.stdout)?.[1];
  console.log(`${tz.padEnd(22)} pass ${pass}  fail ${fail}`);
  if (r.status !== 0) { failed = true; console.log(r.stdout.split("\n").filter((l) => /^not ok|error:/.test(l)).join("\n")); }
}
process.exit(failed ? 1 : 0);
