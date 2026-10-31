// Study Tracker v3 - ホームの一言メッセージ
// 今日・今月の進み具合、連続記録の状態、次のボーナス、試験、今週の学習量、時間帯などから、
// 「いまの状況に合った話題」をいくつか候補に挙げ、重みつきでランダムに1つ選び、その中の言い回しもランダムに選ぶ。
// 毎回同じ文(以前は「今月の目標まで残り…。もう一息です。」だけ)にならないよう、直前に出した文は避ける。
// 数字(残り時間・日数・割合)は、渡されたデータから計算した本当の値だけを使う。

let lastMessage = null; // 直前に出した文(続けて同じ文を出さないため)

const pad2 = (n) => String(n).padStart(2, "0");
function defaultFmt(min) {
  const t = Math.round(min);
  const h = Math.floor(t / 60), m = t % 60;
  return h ? `${h}h${pad2(m)}m` : `${m}m`;
}

// 候補(話題)を作る。各候補: { weight, lines: [言い回し...] }
function candidates(d, now, fmt) {
  const out = [];
  const add = (weight, lines) => { if (weight > 0 && lines.length) out.push({ weight, lines }); };

  const goal = d.daily_goal_min || 0;
  const today = d.today_min || 0;
  const remainToday = Math.max(0, goal - today);
  const ratio = goal > 0 ? today / goal : 0;

  const monthGoal = d.month_goal_min || 0;
  const monthMin = d.month_min || 0;
  const monthRemain = Math.max(0, monthGoal - monthMin);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = lastDay - now.getDate() + 1;                    // 今日を含む
  const perDay = daysLeftInMonth > 0 ? Math.ceil(monthRemain / daysLeftInMonth) : monthRemain;

  const hour = now.getHours();
  const streak = d.streak || 0;
  const state = d.streak_state;
  const daysToBonus = d.next_bonus_days != null ? d.next_bonus_days - streak : null;
  const exam = d.nearest_exam || null;
  const weekTotal = (d.week || []).reduce((s, w) => s + (w.minutes || 0), 0);
  const weekDays = (d.week || []).filter((w) => w.minutes > 0).length;

  // ── 連続記録が危ない/途切れている(最優先) ──
  if (state === "danger" && today === 0) {
    add(6, [
      "連続記録は途切れましたが、新しい記録は今日の1回から始められます。",
      "気持ちを切り替えて、まずは10分だけ机に向かってみましょう。",
      "また今日から積み上げましょう。最初の1記録がいちばん大事です。",
      goal > 0 ? `今日の目標は ${fmt(goal)}。ここから、もう一度始めましょう。` : "ここから、もう一度始めましょう。",
    ]);
  }
  if (state === "warning" && today === 0) {
    add(6, [
      `連続 ${streak}日が続いています。今日の1記録で守れます。`,
      `今日はまだ記録がありません。短い時間でも、連続 ${streak}日をつなぎましょう。`,
      "今日のうちに、まずは1記録。数分でも連続記録はつながります。",
      hour >= 20 ? "夜になりました。寝る前の少しの時間でも、記録は残せます。" : "今日の分を、早めに1つ記録しておきませんか。",
    ]);
  }

  // ── 今日の目標 ──
  if (goal > 0 && today >= goal) {
    const lines = [
      "今日の目標を達成しました。お疲れさまです。",
      "目標クリアです。しっかり休むのも、勉強のうちです。",
      "今日の分は十分です。ここからは自分のペースで。",
    ];
    if (today >= goal * 1.5) lines.push(`目標を大きく超える ${fmt(today)} を記録しています。すばらしい集中力です。`);
    if (monthRemain > 0) lines.push(`今日の目標は達成。今月の目標まで残り ${fmt(monthRemain)} です。`);
    add(5, lines);
  } else if (goal > 0 && today > 0) {
    const lines = ratio < 0.25 ? [
      `良いスタートです。今日の目標まで残り ${fmt(remainToday)}。`,
      "最初の一歩が、いちばん大変です。もう踏み出せています。",
    ] : ratio < 0.5 ? [
      `いいペースです。今日の目標まで残り ${fmt(remainToday)}。`,
      "ここまでは順調です。無理のない範囲で続けましょう。",
    ] : ratio < 0.75 ? [
      `折り返しを過ぎました。今日の目標まで残り ${fmt(remainToday)}。`,
      "半分を超えました。この調子で進みましょう。",
    ] : [
      `あと少しです。残り ${fmt(remainToday)} で今日の目標に届きます。`,
      `ゴールが見えてきました。残り ${fmt(remainToday)}。`,
    ];
    add(5, lines);
  }

  // ── 今月の目標 ──
  if (monthGoal > 0) {
    if (monthRemain === 0) {
      add(3, ["今月の目標を達成しています。ここからは上乗せです。", "今月の目標はクリア済みです。余裕をもって続けましょう。"]);
    } else {
      const mr = monthMin / monthGoal;
      const lines = [
        `今月の目標まで残り ${fmt(monthRemain)}。`,
        `今月の目標まで残り ${fmt(monthRemain)}。1日あたり約 ${fmt(perDay)} で届きます。`,
      ];
      if (daysLeftInMonth > 1) lines.push(`今月は残り ${daysLeftInMonth}日。1日 ${fmt(perDay)} ずつで、目標に届きます。`);
      if (mr >= 0.75) lines.push(`今月の目標まで残り ${fmt(monthRemain)}。ゴールが見えてきました。`);
      if (mr < 0.3 && now.getDate() > 10) lines.push(`今月はこれから巻き返せます。1日 ${fmt(perDay)} ずつ積み上げましょう。`);
      add(3, lines);
    }
  }

  // ── 連続ボーナスが近い ──
  if (daysToBonus != null && daysToBonus >= 1 && daysToBonus <= 3 && state !== "danger") {
    add(3, [
      `あと ${daysToBonus}日続ければ、連続ボーナスです。`,
      `連続ボーナスまで ${daysToBonus}日。今日も記録を重ねましょう。`,
    ]);
  }

  // ── 試験 ──
  if (exam) {
    const left = exam.days_left;
    const done = exam.progress_pct >= 100;
    if (done) {
      add(2, [`「${exam.name}」の目標は達成済みです。復習で仕上げましょう。`]);
    } else if (left <= 14) {
      const lines = [`「${exam.name}」まであと ${left}日。目標の ${exam.progress_pct}% まで来ています。`];
      if (exam.elapsed_pct > exam.progress_pct) lines.push(`「${exam.name}」は、期間の消化に対して学習が少し遅れ気味です。今日の1記録で取り戻しましょう。`);
      if (left <= 3) lines.push(`試験まであと ${left}日。仕上げの時期です。体調管理も忘れずに。`);
      add(left <= 3 ? 5 : 4, lines);
    }
  }

  // ── 今週 ──
  if (weekTotal > 0) {
    add(2, [`今週はここまで ${fmt(weekTotal)}。${weekDays}日 取り組みました。`, `今週の学習は ${fmt(weekTotal)}。積み重なっています。`]);
  } else {
    add(2, ["新しい週の始まりです。まずは1記録から。"]);
  }

  // ── 時間帯 ──
  const periodLines = hour < 5 ? ["夜更かしは禁物です。無理せず、早めに休みましょう。"]
    : hour < 11 ? ["おはようございます。朝は集中しやすい時間です。", "朝のうちに1記録つけておくと、気持ちが楽になります。"]
    : hour < 14 ? ["お昼です。休憩をはさんで、午後も無理なく。"]
    : hour < 18 ? ["午後の学習タイムです。まずは25分から始めてみましょう。"]
    : hour < 22 ? ["夜の時間です。今日の復習もしておきましょう。"]
    : today > 0 ? ["遅い時間です。無理せず、今日はここまでにするのも大事です。"] : ["遅い時間ですが、10分だけでも記録できれば連続が続きます。"];
  add(2, periodLines);

  // ── いつでも(最後の保険。必ず1つは候補になる) ──
  add(1, [
    "コツコツ続けることが、いちばんの近道です。",
    "小さな積み重ねが、あとで大きな差になります。",
    "25分学習して5分休む、を試してみませんか。",
    "完璧を目指すより、まず始めることが大切です。",
    "復習は、翌日・1週間後・1か月後にすると効果的です。",
  ]);
  return out;
}

// d: ホームのデータ(api.get_home_data の結果)。rng は 0以上1未満の乱数を返す関数(テストで固定できる)
export function homeMessage(d, { rng = Math.random, now = new Date(), fmt = defaultFmt } = {}) {
  const cands = candidates(d, now, fmt);
  const total = cands.reduce((s, c) => s + c.weight, 0);
  const pick = () => {
    let r = rng() * total;
    let cand = cands[cands.length - 1];
    for (const c of cands) { r -= c.weight; if (r < 0) { cand = c; break; } }
    return cand.lines[Math.min(cand.lines.length - 1, Math.floor(rng() * cand.lines.length))];
  };
  let msg = pick();
  for (let i = 0; i < 6 && msg === lastMessage; i++) msg = pick(); // 直前と同じ文は避ける(乱数が固定でも無限ループしない)
  lastMessage = msg;
  return msg;
}

export function resetHomeMessageHistory() { lastMessage = null; } // テスト用
