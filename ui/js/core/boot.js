// 起動処理: ①タブの重複防止 → ②保存層の読み込み → ③永続化の要求 → ④ Api の生成。
// 画面の部分(警告の表示)は ui として差し込めるようにして、テストでは差し替える。

import { createTabGuard } from "./tabGuard.js";
import { openStorage, requestPersistence } from "./storage.js";
import { Api } from "./localApi.js";
import { createBrowserPlatform, unsupportedPlatform } from "./platform.js";

export async function bootApp({ ui, locks, indexedDB, navigator: nav, platform } = {}) {
  const guardOpts = { onLost: () => { if (state.store) state.store.freeze(); ui && ui.showLost && ui.showLost(); } };
  if (locks !== undefined) guardOpts.locks = locks;
  const guard = createTabGuard(guardOpts);
  const state = { store: null };

  // ① 別のタブが使用中なら、「このタブで使う」が選ばれるまで待つ(データはまだ読まない)
  const got = await guard.acquire();
  if (!got.ok) {
    if (!ui || !ui.showBlocked) throw new Error("別のタブで開かれています");
    await ui.showBlocked(() => guard.takeOver());
  }

  // ② ロックを取ったあとで読み込む(奪った場合に、相手が最後に書いたデータを読むため)
  const storeOpts = {};
  if (indexedDB !== undefined) storeOpts.indexedDB = indexedDB;
  const store = await openStorage(storeOpts);
  state.store = store;
  if (store.volatile && ui && ui.showVolatile) ui.showVolatile(store.openError);
  store.onError((e) => { if (ui && ui.showSaveError) ui.showSaveError(e); });

  // ③ ブラウザによる自動削除を避ける(許可されるかはブラウザ次第)
  const persistence = await requestPersistence(nav);

  // ④
  const api = new Api(store, { platform: platform ?? (typeof document !== "undefined" ? createBrowserPlatform() : unsupportedPlatform), persistence });
  return { api, store, guard, persistence };
}
