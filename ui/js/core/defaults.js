// 既定値とファイル名。Python 版 data_manager.py の定数の移植。

// 保存するファイル(Python 版の AppData 内の JSON と同じ名前)
export const F = {
  records: "records.json",
  points: "points.json",
  rewards: "rewards.json",
  settings: "settings.json",
  exams: "exams.json",
  tags: "tags.json",
  milestones: "milestones_achieved.json",   // 連続記録・目標ボーナスの付与済み記録
  sabori: "sabori_log.json",                // さぼり券を使った日
  saboriOwned: "sabori_owned.json",         // さぼり券の所持枚数
  launchLog: "launch_log.json",             // アプリを起動した日
  decay: "decay_log.json",                  // ポイント消失の最終適用日
};
export const FILE_NAMES = Object.values(F);

export const DEFAULT_SETTINGS = {
  theme: "system",                                            // "system" | "light" | "dark"
  point_formula: "floor(30 * (minutes / 60) ^ 1.6)",
  manual_point_formula: "floor(points * 0.75)",               // 手動入力専用。points = 1倍でのポイント
  streak_bonus_days: 7,
  streak_bonus_points: 30,
  decay_days: 7,
  decay_rate: 0.02,
  monthly_goal_bonus: 60,
  exam_goal_bonus: 70,
  daily_goal_min: 120,
  monthly_goal_min: 3000,
  sabori_price: 500,
  sabori_max_owned: 2,
  pomodoro: {
    work: 25, short_break: 5, long_break: 15, cycles: 4, pause_sw_on_break: true,
    sound: true,            // フェーズが切り替わったときの音
    volume: 60,             // 音量 0〜100
    desktop_notify: true,   // フェーズ切り替えの通知(アプリが前面にないときだけ)
    idle_inhibit: false,    // 計測中は、画面の消灯・スリープを防ぐ
  },
};

export const DEFAULT_TAGS = [
  { id: 1, name: "数学", color: "#4A90D9" },
  { id: 2, name: "英語", color: "#E67E22" },
  { id: 3, name: "物理", color: "#27AE60" },
  { id: 4, name: "化学", color: "#8E44AD" },
  { id: 5, name: "国語", color: "#E74C3C" },
  { id: 6, name: "その他", color: "#7F8C8D" },
];
