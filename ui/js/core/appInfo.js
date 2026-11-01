// アプリの版の表記。設定ページの「このアプリについて」と、フィードバックで使う。
// (buildInfo.js は、公開用のビルドが丸ごと書き換えるので、手で決める値は、ここに置く)
export const APP_VERSION = "v3.0.0";

// 例: "v3.0.0 (build 774a569215f3)" / 開発中は "v3.0.0 (開発版)"
export const appVersionText = (buildId) => `${APP_VERSION} (${buildId === "dev" ? "開発版" : `build ${buildId}`})`;
