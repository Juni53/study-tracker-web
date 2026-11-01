// サイドバーのタブの並び(DOM には触らない)。key は views/<key>.js(spacer は余白)。
// 「フィードバック」は、フォームの URL が設定されているときだけ、設定タブの上に入る。
export function buildNavItems({ feedback = false } = {}) {
  return [
    { key: "home", icon: "home", label: "ホーム" },
    { key: "timer", icon: "timer", label: "ストップウォッチ" },
    { key: "log", icon: "log", label: "記録ログ" },
    { key: "cal", icon: "cal", label: "カレンダー" },
    { key: "exam", icon: "exam", label: "試験管理" },
    { key: "stats", icon: "stats", label: "統計" },
    { key: "shop", icon: "shop", label: "ショップ" },
    { key: "spacer" },
    ...(feedback ? [{ key: "feedback", icon: "chat", label: "フィードバック" }] : []),
    { key: "settings", icon: "gear", label: "設定" },
  ];
}
