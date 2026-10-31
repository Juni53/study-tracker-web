// ビルドの情報。開発中(リポジトリのままの ui/)は "dev"。公開用のビルド(tools/build-pwa.mjs)が、この中身を書き換える。
// BUILD_ID が "dev" のときは、Service Worker を登録しない(開発中に、古い版が残って困らないように)。
export const BUILD_ID = "dev";
export const BUILT_AT = null;
