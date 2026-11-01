# Study Tracker (Web 版) — 移植の途中経過

`ui/` が、公開するサイトのルートです(GitHub Pages には、このフォルダを公開します)。
Python 版の UI(HTML/CSS/JS)はそのままで、Python 側(`data_manager.py` / `api.py`)を `ui/js/core/` へ JS で移植しています。

## 進み具合

| 段階 | 内容 | 状態 |
|---|---|---|
| 1 | 土台: 保存層(IndexedDB)、複数タブの防止、永続化の要求、`api.js` の差し替え | 完了 |
| 2a | 純粋な計算: 換算式、時間の読み取り、丸め、日付 | 完了(Python 版と照合済み) |
| 2b-1 | DataManager 本体: 記録・ポイント・連続記録・さぼり券・消失・目標・試験・タグ・ショップ・ホーム・カレンダー・統計 | 完了(Python 版と台本で照合済み) |
| 2b-2 | CSV の入出力、全データ削除、通知、画面消灯防止(Wake Lock)。`open_data_folder` は Web 版では廃止 | 完了(CSV は Python 版と照合済み。通知・Wake Lock・ダウンロード・ファイル選択は、偽のブラウザでのテストのみ。実機で要確認) |
| 3 | 実データでの確認 | 利用者が自分のブラウザで実施(下の「デスクトップ版のデータを取り込む」) |
| 4 | 完全バックアップ・復元(上書き / 記録だけ統合)・元に戻す・リマインダー・保存先の選択 | 完了(デスクトップ版バンドルの復元は、Python 版が作った22通りの状態で確認済み。保存先選択・ファイル選択は偽のブラウザでのテストのみ) |
| 5 | PWA 化(オフライン・インストール・更新のお知らせ)と、GitHub Pages への公開の仕組み | 完成(Service Worker は、偽の実行環境でのテストのみ。実際の公開・オフライン動作・インストールは、公開後に実機で要確認) |
| 6 | 初回起動時の案内(「はじめに」。複数ページ: 各タブの説明 → タグ(最初に使う科目を選ぶ) → 注意事項)。試験管理のページから、名前・日付つきで試験を追加できる。設定の「このアプリについて」から、いつでも見直せる | 完了(jsdom でのテストのみ。画面の見た目・スクロール・iPad での表示は、実機で要確認) |
| 7〜8 | フィードバックタブ、仕上げ | これから |

Python 版 `api.py` の公開メソッドは、すべて移植済みです。Web 版だけの API は、`request_notification_permission`(通知の許可)、
`get_storage_info`(保存先・容量・永続化の状態)、バックアップまわり(`localApi.js` の `WEB_ONLY_METHODS`)、
初回案内の `get_onboarding` / `complete_onboarding` / `get_onboarding_tags` / `apply_onboarding_tags`(最初に使う科目の選択)です。「案内を見たか」の印は、`settings.json` ではなく、
バックアップに含まれない「メタ情報」(`onboarding`)に持っています(別の端末で復元しても、その端末では初回の案内が出ます)。設定ページの「保存先」の表示は、このブラウザの中(IndexedDB)の状態を表示します。

## テスト

```
npm install
npm test            # 全テスト
npm run test:tz     # 4つのタイムゾーン(東京・ロサンゼルス・オークランド・UTC)で全テスト
```

- `tests/golden/pure.json`(純粋な計算)と `tests/golden/scenarios.json.gz`(状態を持つ処理)は、Python 版を「正解」として作った照合データです。
  - `scenarios` は、アプリの起動・記録・ショップ・タグ・試験・設定変更・ホーム/カレンダー/統計の問い合わせを、台本どおりに動かした結果(戻り値と保存データ)。手書きの場面と、乱数(シード固定)で作る長い場面があります。
  - 作り直すとき: `python tools/golden/gen_pure.py --src <元のアプリのフォルダ> --out tests/golden` と `python tools/golden/gen_scenarios.py --src <元のアプリのフォルダ> --out tests/golden`
  - 変更の確認には、コードをわざと壊して(変異)テストが落ちることを見る方法が有効でした。
- 照合で意図的に違えている点(安全側): 他の文字種の数字(アラビア数字など)は受け付けない／結果が無限大になる換算式は fallback にする。

## 画面を確かめる

ES モジュールを使うため、ファイルをダブルクリックして開く(`file://`)ことはできません。簡易サーバー経由で開きます(Chrome か Edge)。

```
python tools/serve.py        # → http://localhost:8000/   (止めるには Ctrl+C)
```

Windows では `python` の代わりに `py` と打つ場合があります。標準の `python -m http.server` は、Windows の環境によっては
.js を text/plain で返してしまい、ブラウザが読み込みを拒否することがあるため、専用のスクリプトを用意しています。
データはブラウザ内(IndexedDB)に、「アドレス(ポート番号まで)ごとに別々に」保存されます。ポート番号を変えると、別のデータになります。

## デスクトップ版のデータを取り込む(手順3)

1. デスクトップ版のあるパソコンで、`python tools/export_desktop_data.py` を実行する(`study_tracker_desktop_data_日時.json` ができる)。
2. Web 版の 設定 → データ管理 →『バックアップから復元』で、そのファイルを選ぶ。
3. 確認画面で内容(記録の件数・期間・ポイント)を見て、『上書きして復元』を押す。
4. ホーム・カレンダー・統計の数字を、デスクトップ版と見比べる。
5. 違っていたら、設定の『元に戻す』で、復元の直前の状態に戻せる(復元の前に、いまのデータを自動で控える)。

- 復元は、ファイルの中身を先に検証します。1つでも問題があれば、何も変更せずに理由を表示します(例: 日付として不正な記録を含む)。
- 『記録だけ統合』は、別の端末のバックアップから、足りない記録だけを足す機能です。ポイント・報酬・設定などは、いまのままです。
- Web 版のバックアップ(`study_tracker_backup_日付.json`)も、同じ『バックアップから復元』で読み込めます。
- バックアップのリマインダーは、設定で周期(毎週 / 2週間ごと / 毎月 / 通知しない)を選べます。起動時、周期がたっていれば右下に小さく出ます。

## 公開(GitHub Pages)の手順

リポジトリ: `Juni53/study-tracker-web`。公開後のアドレスは `https://juni53.github.io/study-tracker-web/` です。
(GitHub Pages は、無料のプランでは、公開(public)のリポジトリだけが対象です。)

1. このフォルダの中身を、リポジトリのフォルダにコピーして、`main` ブランチに commit・push する(`.github/` も含める)。
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする(最初の1回だけ)。
3. **Actions** タブで「Deploy to GitHub Pages」が動く。テスト(4つのタイムゾーン) → ビルド → 公開の順で、すべて緑になれば完了。
   - 以降は、`main` に push するたびに、自動で、テストを通してから公開される。テストが1つでも失敗すると、公開されない。
4. 公開されたアドレスを Chrome / Edge で開く → アドレスバーの右の「インストール」(または、設定ページの「アプリとしてインストール」)。
5. `main` 以外のブランチ名にしている場合は、`.github/workflows/deploy.yml` の `branches: [main]` を直す。

**更新の仕組み**: push すると、ファイルの中身から決まる「版」(build)が変わる。公開済みのアプリを開いている人には、
右下に「新しいバージョンがあります」と出て、「更新する」で切り替わる(記録は、そのまま残る)。設定ページに、版が表示される。

**ビルドをローカルで試す**(オフライン・インストールの確認):
```
node tools/build-pwa.mjs --out dist      # dist/ ができる(ui/ は変更されない)
python tools/serve.py --root dist        # → http://localhost:8000/
```
開発中の `ui/`(`python tools/serve.py`)は、Service Worker を登録しないので、古い版が残って困ることはない。
ビルドした dist/ は、Chrome の開発者ツール → Application → Service Workers で確かめられる(「Offline」にチェックして、再読み込み)。

**公開しないもの**: 学習の記録(`study_tracker_desktop_data_*.json` など)は、リポジトリに入れない(`.gitignore` 済み)。
データは、各自のブラウザの中にだけ保存される。

## 見た目・操作の決まりごと(タッチ環境への配慮)

- **ホバーの見た目**は、必ず次の形で書きます(`tests/css.touch.test.js` が、すべての規則を確認します)。
  `@media (any-hover:hover){ :where(:root:not(.is-touch)) セレクタ:hover{ ... } }`
  - タッチ操作では、指を離したあとも `:hover` が残り続けるためです。
  - ホバーできる入力が無い端末(スマホ・タブレット)では、`@media` で無効になります。
  - タッチ画面つきのパソコン・Chromebook(マウスもある端末)では、触ったあとの間だけ `<html>` に `is-touch` が付き(`js/components/inputMode.js`。マウスを動かすと外れる)、そのあいだは出ません。
  - `:where()` は優先度を足さないので、`:active` の規則との強さの関係は変わりません。
- JS のホバー表示(星評価・カレンダーの吹き出し)も、`isTouchInput()` を見て、タッチ中は出しません。
- タップしたときの、ブラウザ標準の青いハイライトは、透明にしています(`tokens.css`)。
- **選択肢の列**(ラジオボタンのように1つだけ選ぶボタンの列)は、`components/radioGroup.js` の `bindRadioGroup(入れ物, 選ばれたときの処理)` で作ります。入れ物の中だけが対象になり、同じページの別の列には影響しません。

## 他の端末(同じ LAN / Wi-Fi)から開く

```
python tools/serve.py --lan        (Windows は start_lan.bat をダブルクリックでも可)
```

表示された `http://192.168.…:8000/` のようなアドレスを、同じ Wi-Fi につながっている他の端末で開きます。

- 公開するのは `ui/` の中身だけです(学習データは、各端末のブラウザの中にあり、サーバーには無い)。
- 接続を受け付けるのは、家庭内などのプライベートなアドレスの端末だけです。インターネット側からは 403 で拒否します。
- 初回は、Windows のファイアウォールの確認が出ます。『プライベート ネットワーク』だけにチェックして許可してください。
- カフェ・学校・ホテルなど、知らない人がいるネットワークでは使わないでください。
- 開けないときは、ゲスト用 Wi-Fi など『端末どうしの通信を禁止』している接続ではないか確認してください。

**http のアドレスでは、ブラウザの制限で使えない機能があります**(`localhost` だけは例外で、LAN の IP は例外になりません)。

| 機能 | LAN の http | 理由 |
|---|---|---|
| 画面・記録・ショップ・統計など、基本の動作 | 使える | |
| 保存(IndexedDB) | 使える | |
| 複数タブの防止(Web Locks) | **使えない**(防止が働かない) | HTTPS(または localhost)のみ |
| 永続化の要求(`storage.persist`) | **使えない** | 同上 |
| PWA(インストール・オフライン)、通知、画面消灯防止 | **使えない** | 同上 |

Chromebook / Windows の Chrome・Edge では、試験用に例外を設定できます。
`chrome://flags/#unsafely-treat-insecure-origin-as-secure`(Edge は `edge://flags/...`)を『Enabled』にして、
入力欄に `http://192.168.0.5:8000` のようにアドレスを書き、ブラウザを再起動します。iPad(Safari)にはこの設定が無いため、
PWA まで含めた確認は、公開後の https のアドレス(GitHub Pages)で行います。

別のネットワーク(自宅の外など)の端末で見たいときは、LAN のサーバーは使えません。公開後のアドレス(GitHub Pages)を使います。

## 構成

```
ui/js/core/
  dates.js       日付(現地日付。UTC にならない)
  num.js         Python と同じ丸め(偶数丸め)・// ・%
  formula.js     換算式(eval を使わない自作パーサ)
  duration.js    時間の読み取り(parse_duration)・表示(fmt_time)
  storage.js     IndexedDB。JSON ファイル単位で保存、書き込みは裏で・失敗時は再試行
  tabGuard.js    Web Locks による「同時に使えるのは1タブだけ」
  backup.js      完全バックアップの形式・検証・要約・リマインダーの判定
  csv.js         CSV の読み書き(Python の csv モジュールと同じ結果)・文字コード判定(UTF-8 → cp932)
  platform.js    ブラウザ固有の機能(ダウンロード・ファイル選択・通知・Wake Lock・再読み込み)
  boot.js / bootUi.js   起動順序と警告画面
  defaults.js / dataManager.js / localApi.js   既定値・データ管理・API(Python 版の API はすべて移植済み)
ui/js/components/backupBanner.js   バックアップのリマインダー(右下の小さなお知らせ)
ui/js/components/inputMode.js      タッチ操作中かどうか(<html> の is-touch)
ui/js/components/radioGroup.js     選択肢の列(入れ物の中だけが対象)
ui/sw.js              Service Worker(ビルドで、版と保存するファイルの一覧が書き込まれる)
ui/js/pwa.js          Service Worker の登録と、更新の受け取り
ui/js/components/install.js   アプリとしてインストールの案内
tools/build-pwa.mjs   公開用のビルド(ui/ → dist/)
tools/make_icons.py   アイコンの生成
.github/workflows/deploy.yml   公開のワークフロー(テスト → ビルド → GitHub Pages)
ui/js/api.js     UI からの入口(引数・戻り値を複製して渡す = 内部データを守る)
tools/serve.py   手元で開くための簡易サーバー(--lan で同じ LAN の他の端末にも公開)
start.bat / start_lan.bat   Windows 用の起動(ダブルクリック)
tools/export_desktop_data.py   デスクトップ版の AppData を 1 つの JSON にまとめる(移行用)
```
