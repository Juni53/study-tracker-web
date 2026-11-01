// 初回起動時の案内(「はじめに」)。複数のページを「次へ / 戻る」でめくる:
//   各タブの説明(ホーム〜設定、8ページ) → タグ(最初に使う科目を選ぶ) → 注意事項(最後のページ)
//   await showOnboardingIfFirst(api, { onOpenBackup, onAddExam })   … まだ見ていなければ出す。閉じたら解決する(出さなかったときは null)
//   await showOnboarding(api, { first: false, ... })                 … 設定ページから、いつでも見直せる(見たことの記録は変えない)
// 「見たか」の印は、閉じたとき(最後のボタン・×・Esc のどれでも)に api.complete_onboarding() で付ける(メタ情報。localApi.js を参照)。
// 閉じる前にページを閉じたときは、印が付かないので、次の起動でもう一度出る。
//
// ・試験管理のページの「試しに追加」ボタンは、onAddExam({ name, date }) を呼ぶ。そのあいだ、案内は一時的に隠れ(閉じたことにはならない)、
//   試験の追加ポップアップが閉じたら、同じページに戻る。onAddExam が渡されていなければ、ボタンは出さない。
// ・タグのページで選んだ内容は、「次へ」「戻る」でそのページを離れるときに反映する(閉じるだけでは反映しない)。
// ・背景(ポップアップの外)を押しても閉じない(うっかり閉じて、読み損ねないように)。閉じるのは、最後のボタン・×・Esc。
// ・キーボードは dialog.js と同じ: Tab はポップアップの中だけを巡る。Enter の押しっぱなしは無視する(開いたキーの連打で、すぐ閉じないように)。
// ・長いページは、真ん中だけがスクロールする。ポップアップの高さは一定(ページを変えても「次へ」の位置が動かない)。

import { canInstall, promptInstall, isStandalone, installHowTo, onInstallStateChange } from "./install.js";
import { todayIso } from "../core/dates.js";
import { feedbackLink } from "../core/feedback.js";

const CLOSE_MS = 450; // 閉じるアニメーション(約0.2秒)が終わってから要素を取り除く
let seq = 0;          // ポップアップごとに、タイトルの id を変える(閉じるアニメーション中のものと重ならないように)

// 試験管理のページの「試しに追加」。名前と日付は、追加のポップアップに、入力済みの状態で出す。日付が過ぎたら、ボタンごと出さない。
export const SAMPLE_EXAM = { label: "二学期期末試験 を追加", name: "二学期期末試験", date: "2026-11-24" };

const list = (items) => `<ul class="onb-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

// ページの中身(静的な HTML。ユーザーの入力は含まない)。mount が要るページ(試験・タグ・注意事項)は、本体(showOnboarding)の中で組み立てる。
export const PAGES = [
  {
    key: "home", title: "ホーム",
    html: ({ first }) => `${first ? `<div class="onb-welcome">Study Tracker へようこそ。各タブでできることを、順に紹介します。</div>` : ""}
      <div class="onb-t">今日の勉強の状況を、ひと目で確かめるタブです。</div>
      ${list([
        "<b>連続記録</b>: 何日続けて勉強したか。はじめの設定では、7日続けるごとにボーナスポイントがもらえます。",
        "今日と今月の<b>目標</b>に対する、進み具合。",
        "いちばん近い<b>試験</b>までの日数と、勉強の進み具合。",
        "1週間の勉強時間のグラフ、タグ別の内訳、ポイントの履歴。",
      ])}`,
  },
  {
    key: "timer", title: "ストップウォッチ",
    html: () => `<div class="onb-t">勉強の時間を計って、記録するタブです。</div>
      ${list([
        "「開始」で計りはじめ、終わったら「保存」。タイトル・充実度(星)・タグ・関連する試験を付けて、記録します。",
        "記録すると、時間に応じた<b>ポイント</b>がたまります。はじめの設定では、1回の記録が長いほど、1時間あたりのポイントが多くなります。",
        "<b>ポモドーロタイマー</b>(作業と休憩のくり返し)も使えます。「ストップウォッチ連動」で、ストップウォッチと一緒に動かせます。",
      ])}`,
  },
  {
    key: "log", title: "記録ログ",
    html: () => `<div class="onb-t">これまでの勉強の記録を、一覧で見るタブです。</div>
      ${list([
        "日付ごとに並びます。「新しい順 / 古い順」の切り替えと、<b>タグでの絞り込み</b>ができます。",
        "「＋ 手動で追加」で、ストップウォッチを使わなかった勉強も記録できます。手動で入れた分のポイントは、はじめの設定では0.75倍になります。",
        "タイトルは、いつでも直せます。<b>タグと試験の紐づけは、記録した当日だけ</b>変えられます。",
      ])}`,
  },
  {
    key: "cal", title: "カレンダー",
    html: () => `<div class="onb-t">勉強した日を、カレンダーで見るタブです。</div>
      ${list([
        "日ごとの勉強時間が、色の濃さ(少 → 多)で表示されます。「‹ ›」で、月を切り替えます。",
        "日付を押すと、その日の記録を詳しく見られます。パソコンでは、カーソルを合わせると概要も出ます。",
        "連続記録や、今月の目標の達成状況も確かめられます。",
      ])}`,
  },
  {
    key: "exam", title: "試験管理",
    html: ({ sampleExam }) => `<div class="onb-t">試験に向けた、勉強の進み具合を管理するタブです。</div>
      ${list([
        "試験の<b>名前・日付・目標の勉強時間</b>を登録します。",
        "記録に試験を紐づけると、その試験に向けた勉強時間が数えられ、「学習進捗」と、日付が近づく「期間消化」が、並んで表示されます。",
        "目標を達成すると、ボーナスポイントがもらえます(はじめの設定では70ポイント)。",
      ])}
      ${sampleExam ? `<div class="onb-act" data-onb="examAct">
        <div class="onb-t">試しに、試験を1つ登録してみましょう。名前と日付が入った状態で、追加の画面が開きます。</div>
        <div class="onb-act-row"><button type="button" class="btn muted small" data-onb="exam">${SAMPLE_EXAM.label}</button> <span class="onb-note" data-onb="examNote"></span></div>
      </div>` : ""}`,
  },
  {
    key: "stats", title: "統計",
    html: () => `<div class="onb-t">勉強をふり返って、傾向をつかむタブです。</div>
      ${list([
        "「今週・今月・全期間」を切り替えて見ます。先週・先月の同じ時点との比較も出ます。",
        "日別・月別の学習時間、曜日ごとの平均、<b>タグ別の内訳</b>、記録に付けた<b>充実度(星)</b>の分布が見られます。",
      ])}`,
  },
  {
    key: "shop", title: "ショップ",
    html: () => `<div class="onb-t">ためたポイントを、ごほうびと交換するタブです。</div>
      ${list([
        "「＋ 報酬を追加」で、ほしいものの名前と、必要なポイントを登録します。ポイントがたまったら、交換できます。",
        "<b>さぼり券</b>(はじめは500ポイント。最大2枚まで)を持っていると、勉強もアプリの起動もしなかった日に自動で使われて、連続記録が途切れません。",
        "ただし、勉強の記録がない日が7日(はじめの設定)を超えると、ためたポイントが<b>毎日2%ずつ減ります</b>。さぼり券では、この減少は防げません。",
      ])}`,
  },
  {
    key: "settings", title: "設定",
    html: () => `<div class="onb-t">表示や目標、データの管理をするタブです。</div>
      ${list([
        "表示テーマ(システム・ライト・ダーク)と、1日・1か月の<b>学習目標</b>。",
        "<b>タグ</b>の追加・名前や色の変更・並び替え・削除。",
        "<b>データ管理</b>: バックアップの保存と復元、バックアップのリマインダー、記録のCSVの書き出しと取り込み。",
        "「高度な設定」: ポイントの換算式、さぼり券、ポイントの消失、ボーナス、全データの削除など。",
        "「このアプリについて」: バージョン、インストール、この案内の見直し。",
      ])}`,
  },
  {
    key: "tags", title: "タグ",
    html: () => `<div class="onb-t">タグは、勉強の<b>科目などを分ける印</b>です。記録に付けると(複数も可)、ホームや統計で、科目ごとの勉強時間の内訳が見られます。色も付いていて、設定の「タグ」から、あとでいつでも、追加・名前や色の変更・並び替え・削除ができます。</div>
      <div class="onb-h2">最初に使う科目を選んでください</div>
      <div class="onb-chks" data-onb="tagBox"><div class="onb-note">読み込み中…</div></div>
      <div class="onb-note onb-tagnote">「次へ」を押すと、選んだ内容が反映されます。すでに記録で使っているタグは、外せません。</div>
      <div class="onb-err" data-onb="tagErr" role="alert" hidden></div>`,
  },
  {
    key: "notes", title: "注意事項",
    html: ({ feedback }) => `
      <section class="onb-sec" data-onb-sec="storage">
        <h3 class="onb-h">データの保存場所</h3>
        <div class="onb-t">記録・ポイント・設定は、いま使っている<b>このブラウザの中</b>にだけ保存されます。別の端末や、別のブラウザとは共有されません。ブラウザの「サイトデータ」を削除すると、記録も消えます。</div>
      </section>
      <section class="onb-sec" data-onb-sec="backup">
        <h3 class="onb-h">バックアップのお願い</h3>
        <div class="onb-t">万一のために、<b>定期的にバックアップ</b>を取ってください。設定ページの「データ管理」から、ボタン1つで保存できます。取りどきは、リマインダー(はじめは毎週。周期は変えられます)でお知らせします。</div>
        <div class="onb-act"><button type="button" class="btn muted small" data-onb="backup">データ管理を開く</button></div>
      </section>
      <section class="onb-sec" data-onb-sec="install">
        <h3 class="onb-h">アプリとして使う(インストール)</h3>
        <div class="onb-t"><span data-onb="installLead">インストールすると、デスクトップやホーム画面から、アプリのように開けます(オフラインでも使えます)。</span> <span data-onb="installHow"></span></div>
        <div class="onb-act" data-onb="installAct" hidden><button type="button" class="btn muted small" data-onb="install">アプリとしてインストール</button></div>
      </section>
      <section class="onb-sec" data-onb-sec="move">
        <h3 class="onb-h">端末を移るとき</h3>
        <ol class="onb-t onb-steps">
          <li>これまでの端末で、設定の「バックアップを保存」を押します。</li>
          <li>保存したファイルを、新しい端末へ送ります(メールやクラウドなど)。</li>
          <li>新しい端末で、このアプリを開き、設定の「バックアップから復元」を押します。</li>
        </ol>
      </section>
      <section class="onb-sec" data-onb-sec="privacy">
        <h3 class="onb-h">プライバシー</h3>
        <div class="onb-t">記録や設定は、外部のサーバーへ送られません。すべて、この端末の中で処理されます。アプリの新しい版を確認するために、このサイトへ接続することはありますが、記録は含まれません。${feedback
          ? ` 外へ出るのは、「フィードバック」タブのリンクを開いたときだけです(フォームのページ=外部のサービスへ移動します${feedback.withVersion ? "。そのとき、アプリのバージョンだけがフォームに渡されます" : ""})。`
          : ""}</div>
      </section>`,
  },
];

export async function showOnboardingIfFirst(api, opts = {}) {
  let st;
  try { st = await api.get_onboarding(); } catch { return null; } // 状態が分からなければ、出さない(アプリは使える)
  if (!st || st.done || st.volatile) return null; // 見た後 / 保存できない環境(その警告が出ている。案内の「保存されます」が事実と違う)は、出さない
  return showOnboarding(api, { ...opts, first: true });
}

export function showOnboarding(api, { first = false, onOpenBackup = null, onAddExam = null, feedback = feedbackLink(), doc = document } = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    const overlay = doc.createElement("div");
    overlay.className = "modal-overlay dlg onb-overlay";
    overlay.innerHTML = `
      <div class="modal-box onb" role="dialog" aria-modal="true" aria-labelledby="onbTitle${id}">
        <div class="onb-head">
          <div class="onb-step mono" data-onb="step"></div>
          <div class="modal-title" id="onbTitle${id}" data-onb="title" aria-live="polite"></div>
          <button type="button" class="modal-close" data-onb="close" aria-label="閉じる">✕</button>
        </div>
        <div class="onb-body" data-onb="body"></div>
        <div class="onb-foot">
          <div class="onb-dots" aria-hidden="true">${PAGES.map(() => "<span></span>").join("")}</div>
          <div class="onb-nav">
            <button type="button" class="btn muted" data-onb="prev">戻る</button>
            <button type="button" class="btn primary" data-onb="next">次へ</button>
          </div>
        </div>
      </div>`;

    const q = (sel) => overlay.querySelector(sel);
    const body = q('[data-onb="body"]');
    const titleEl = q('[data-onb="title"]');
    const stepEl = q('[data-onb="step"]');
    const prevBtn = q('[data-onb="prev"]');
    const nextBtn = q('[data-onb="next"]');
    const dots = [...overlay.querySelectorAll(".onb-dots span")];

    let idx = 0;
    let busy = false;      // タグを反映している間(ページを動かさない)
    let away = false;      // 試験の追加ポップアップのあいだ、案内を隠している
    let closed = false;
    let examAdded = false;
    let tagState = null;   // タグのページ: { base: 読み込んだときの選択, checked: いまの選択 }
    let cleanup = null;    // ページを離れるときに呼ぶ後始末

    // ── インストールの項目(注意事項のページ): インストール済みなら出さない / 合図があればボタン / 無ければ手順の文 ──
    function paintInstall() {
      const sec = q('[data-onb-sec="install"]');
      if (!sec || !sec.isConnected) return;
      if (isStandalone()) { sec.hidden = true; return; } // すでにアプリとして開いている
      sec.hidden = false;
      const ready = canInstall();
      q('[data-onb="installAct"]').hidden = !ready;
      q('[data-onb="installHow"]').textContent = ready ? "" : installHowTo();
    }
    const unsubInstall = onInstallStateChange(paintInstall);

    // ── 試験のページ: ボタンで、追加のポップアップを(名前・日付つきで)開く。そのあいだ、案内は隠れる ──
    function setAway(on) {
      away = on;
      overlay.classList.toggle("open", !on);
    }
    function mountExam() {
      const act = q('[data-onb="examAct"]');
      if (!act) return null;
      const btn = q('[data-onb="exam"]');
      const note = q('[data-onb="examNote"]');
      let alive = true;
      const paintAdded = () => { btn.disabled = true; note.textContent = "追加しました。試験管理タブで確かめられます。"; };
      if (examAdded) paintAdded();
      else {
        Promise.resolve().then(() => api.get_exams()).then((exams) => {
          if (alive && Array.isArray(exams) && exams.some((e) => e.name === SAMPLE_EXAM.name && e.date === SAMPLE_EXAM.date)) paintAdded();
        }).catch(() => { /* 確かめられなくても、ボタンは使える */ });
      }
      btn.addEventListener("click", async () => {
        if (away || busy || btn.disabled) return;
        setAway(true);
        let r = null;
        try { r = await onAddExam({ name: SAMPLE_EXAM.name, date: SAMPLE_EXAM.date }); } catch (e) { console.error("試験の追加画面を開けませんでした", e); }
        if (closed) return;
        setAway(false);
        if (r && r.added) { examAdded = true; paintAdded(); }
        (btn.disabled ? nextBtn : btn).focus({ preventScroll: true });
      });
      return () => { alive = false; };
    }

    // ── タグのページ: 選べる科目をチェックボックスで出す。反映は、ページを離れるとき(leaveTags) ──
    function mountTags() {
      const box = q('[data-onb="tagBox"]');
      tagState = null;
      let alive = true;
      Promise.resolve().then(() => api.get_onboarding_tags()).then((res) => {
        if (!alive) return;
        const tags = res && Array.isArray(res.tags) ? res.tags : null;
        if (!tags) throw new Error("タグの候補を取得できません");
        const checked = new Set(tags.filter((t) => t.checked).map((t) => t.name));
        tagState = { base: new Set(checked), checked };
        box.textContent = "";
        for (const t of tags) {
          const label = doc.createElement("label");
          label.className = `onb-chk${t.in_use ? " locked" : ""}`;
          const input = doc.createElement("input");
          input.type = "checkbox"; input.dataset.tag = t.name; input.checked = !!t.checked; input.disabled = !!t.in_use;
          input.addEventListener("change", () => { if (input.checked) checked.add(t.name); else checked.delete(t.name); });
          const mark = doc.createElement("span"); mark.className = "onb-chk-box"; mark.setAttribute("aria-hidden", "true"); mark.textContent = "✓";
          const sw = doc.createElement("span"); sw.className = "onb-chk-sw"; sw.style.background = t.color;
          const name = doc.createElement("span"); name.className = "onb-chk-name"; name.textContent = t.name;
          label.append(input, mark, sw, name);
          if (t.in_use) { const n = doc.createElement("span"); n.className = "onb-chk-note"; n.textContent = "使用中"; label.append(n); }
          box.append(label);
        }
      }).catch(() => {
        if (!alive) return;
        box.innerHTML = `<div class="onb-note">タグの設定を読み込めませんでした。あとから、設定の「タグ」で変えられます。</div>`;
      });
      return () => { alive = false; };
    }
    // タグのページを離れていいか(選びが変わっていれば、反映する。失敗したら、理由を出してそのページに残る)
    async function leaveTags() {
      if (!tagState) return true;
      const { base, checked } = tagState;
      if (checked.size === base.size && [...checked].every((n) => base.has(n))) return true;
      const err = q('[data-onb="tagErr"]');
      try {
        const r = await api.apply_onboarding_tags([...checked]);
        if (r && r.ok) { err.hidden = true; return true; }
        err.textContent = `タグを反映できませんでした${r && r.error ? `(${r.error})` : ""}`;
      } catch { err.textContent = "タグを反映できませんでした"; }
      err.hidden = false;
      return false;
    }

    const MOUNTS = { exam: mountExam, tags: mountTags, notes: () => { paintInstall(); return null; } };

    function showPage(i) {
      if (cleanup) { cleanup(); cleanup = null; }
      idx = i;
      const page = PAGES[i];
      body.innerHTML = page.html({ first, feedback, sampleExam: typeof onAddExam === "function" && SAMPLE_EXAM.date >= todayIso() });
      body.scrollTop = 0;
      titleEl.textContent = page.title;
      stepEl.textContent = `${i + 1} / ${PAGES.length}`;
      dots.forEach((d, k) => d.classList.toggle("on", k === i));
      prevBtn.hidden = i === 0;
      nextBtn.textContent = i === PAGES.length - 1 ? (first ? "はじめる" : "閉じる") : "次へ";
      const mount = MOUNTS[page.key];
      if (mount) cleanup = mount() || null;
    }

    async function go(delta) {
      if (busy || away) return;
      if (PAGES[idx].key === "tags") {
        busy = true; prevBtn.disabled = nextBtn.disabled = true;
        const ok = await leaveTags();
        busy = false; prevBtn.disabled = nextBtn.disabled = false;
        if (!ok || closed) return;
      }
      const to = idx + delta;
      if (to < 0) return;
      if (to >= PAGES.length) { finish(); return; }
      showPage(to);
    }

    const prevFocus = doc.activeElement;
    const finish = (afterClose = null) => {
      if (closed) return;
      closed = true;
      doc.removeEventListener("keydown", onKey, true);
      unsubInstall();
      if (cleanup) { cleanup(); cleanup = null; }
      overlay.classList.remove("open");
      setTimeout(() => overlay.remove(), CLOSE_MS);
      if (prevFocus && prevFocus !== doc.body && prevFocus.isConnected && typeof prevFocus.focus === "function") {
        prevFocus.focus({ preventScroll: true });
      }
      // 初回だけ「見た」印を付ける(次の afterClose より前に呼ぶ。印が付けられなくても、案内は閉じる)
      if (first) { try { Promise.resolve(api.complete_onboarding()).catch(() => {}); } catch { /* 印が付かなければ、次の起動でもう一度出るだけ */ } }
      resolve();
      if (afterClose) afterClose();
    };

    const onKey = (e) => {
      if (away) return; // 試験の追加ポップアップのあいだは、案内はキーを受けない
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        finish();
      } else if (e.key === "Enter") {
        if (e.repeat) { e.preventDefault(); e.stopPropagation(); } // 押しっぱなしの連打は無視。通常の Enter は、フォーカス中のボタンがそのまま押される
      } else if (e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        overlay.classList.add("kbd"); // これ以降、フォーカス中のボタンに薄い背景色が付く
        const focusables = [...overlay.querySelectorAll("button, input[type=checkbox]")].filter((b) => !b.disabled && !b.closest("[hidden]") && !b.hidden);
        const i = focusables.indexOf(doc.activeElement);
        const next = e.shiftKey ? (i <= 0 ? focusables.length - 1 : i - 1) : (i < 0 || i === focusables.length - 1 ? 0 : i + 1);
        focusables[next].focus();
      }
    };

    overlay.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-onb]");
      if (!b || b.disabled) return;
      switch (b.dataset.onb) {
        case "close": finish(); break;
        case "prev": go(-1); break;
        case "next": go(+1); break;
        case "backup": finish(typeof onOpenBackup === "function" ? onOpenBackup : null); break;
        case "install": promptInstall().then(paintInstall); break;
        default: break; // "exam" は、mountExam が受ける
      }
    });
    doc.addEventListener("keydown", onKey, true);

    doc.body.appendChild(overlay);
    showPage(0);
    void overlay.offsetWidth; // 閉じた状態を一度描画させてから open を付ける(付けないと遷移しない)
    overlay.classList.add("open");
    nextBtn.focus({ preventScroll: true });
  });
}
