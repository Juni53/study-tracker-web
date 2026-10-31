// Study Tracker v3 - 滑らかな折れ線/エリアチャートの共通ヘルパー
// デザイン案(ホーム/設定/ショップ)で使っていた Catmull-Rom → ベジェ変換をここに集約する。

export function catmullRom2bezier(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// values: 数値配列。横幅は values.length 分(例: 月〜日の7枠)を常に確保して等間隔に並べる。
// todayIndex を渡すと、その位置までしか線を描かない(未来の曜日は空欄のまま)。
// 呼吸ドットは、最後の点ではなく todayIndex の位置に置く。
export function renderSmoothChart(container, values, { todayIndex = null } = {}) {
  const W = Math.round(container.clientWidth) || 700;
  const H = 96, padX = 20, top = 14, bottom = 10;
  const n = values.length;
  const xs = values.map((_, i) => padX + (i * (W - 2 * padX)) / (n - 1));

  const activeN = todayIndex != null ? todayIndex + 1 : n;
  const activeValues = values.slice(0, activeN);
  const activeXs = xs.slice(0, activeN);
  const max = Math.max(...activeValues.filter((v) => !isNaN(v)), 0.0001);
  const activeYs = activeValues.map((v) => (H - bottom) - (Math.max(v, 0) / (max * 1.15)) * (H - bottom - top));
  const points = activeXs.map((x, i) => [x, activeYs[i]]);

  const gid = "grad" + Math.random().toString(36).slice(2, 8);
  let pathD = "", areaD = "";
  if (points.length >= 2) {
    pathD = catmullRom2bezier(points);
    areaD = `${pathD} L${points[points.length - 1][0]},${H} L${points[0][0]},${H} Z`;
  } else if (points.length === 1) {
    // 月曜日など、1点だけ(=今日の分しかない)の場合は、ただのドットだと寂しいので
    // 今日の値の高さのまま、半日分だけ左へ伸ばした短い水平線として見せる。
    const [x, y] = points[0];
    const dayWidth = n > 1 ? (W - 2 * padX) / (n - 1) : W / 2;
    const stubStart = Math.max(2, x - dayWidth / 2);
    pathD = `M${stubStart},${y} L${x},${y}`;
    areaD = `${pathD} L${x},${H} L${stubStart},${H} Z`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="var(--ink)" stop-opacity="0"/>
      </linearGradient></defs>
      ${areaD ? `<path d="${areaD}" fill="url(#${gid})" stroke="none"/>` : ""}
      <path class="chart-line" d="${pathD}" fill="none" stroke="var(--ink)" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    </svg>
    ${todayIndex != null ? '<span class="halo"></span><span class="core"></span>' : ""}
  `;
  if (todayIndex != null && points.length) {
    const [lx, ly] = points[points.length - 1];
    container.querySelectorAll(".halo, .core").forEach((el) => {
      el.style.left = (lx / W) * 100 + "%";
      el.style.top = (ly / H) * 100 + "%";
    });
  }
}

export function barScale(values, headroom = 1.15) {
  const max = Math.max(...values, 1);
  return values.map((v) => (v / (max * headroom)) * 100);
}
