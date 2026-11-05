// Study Tracker v3 - 滑らかな折れ線/エリアチャートの共通ヘルパー
// デザイン案(ホーム/設定/ショップ)で使っていた Catmull-Rom → ベジェ変換をここに集約する。

const PENDING_LABEL = "確定前(保存すると変わる可能性があります)"; // components/pending.js の PEND_LABEL と同じ文言

// 曲線の 1 区間ずつの文字列("C…")を返す(i 番目 = pts[i] から pts[i+1] まで)。つなげると、catmullRom2bezier の曲線になる
export function catmullRom2segments(pts) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    segs.push(` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`);
  }
  return segs;
}

export function catmullRom2bezier(pts) {
  return `M${pts[0][0]},${pts[0][1]}` + catmullRom2segments(pts).join("");
}

// values: 数値配列。横幅は values.length 分(例: 月〜日の7枠)を常に確保して等間隔に並べる。
// todayIndex を渡すと、その位置までしか線を描かない(未来の曜日は空欄のまま)。
// 呼吸ドットは、最後の点ではなく todayIndex の位置に置く。
// pendingIndex を渡すと、その点を「確定前」として示す(計測が日付をまたいでいる間の、開始日。todayIndex より前の点だけ有効):
//   ・その点は、中空の丸(半径 5・塗りは紙色・線は ink で 2)。
//   ・その点から次の点までの線は、破線(5 4)。
//   ・その点のまわりに、縦の斜線の帯(SVG の <pattern>: 45 度回転・線は ink・太さ 1.5・間隔 6。濃さは --pend-line-a)。
//     帯の下には、背景色(--paper)のオーバーレイ(濃さは --pend-wash-a)を敷く。
//     重ね順: 面の塗り → 背景色のオーバーレイ → 斜線 → 線 → 丸(線と丸は、斜線の上。くっきり保つ)。
//     帯の幅は、点の間隔に対して、点の手前 0.44・次の点の先 0.19(デザインのイメージの 405〜535 に当たる)。
export function renderSmoothChart(container, values, { todayIndex = null, pendingIndex = null } = {}) {
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
  const pend = Number.isInteger(pendingIndex) && pendingIndex >= 0 && pendingIndex < points.length - 1 ? pendingIndex : null; // 次の点がある点だけ
  const stroke = `fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
  let pathD = "", areaD = "", lines = "", pendBand = "", pendDot = "", pendDefs = "";
  if (points.length >= 2) {
    pathD = catmullRom2bezier(points);
    areaD = `${pathD} L${points[points.length - 1][0]},${H} L${points[0][0]},${H} Z`;
    if (pend === null) {
      lines = `<path class="chart-line" d="${pathD}" ${stroke}/>`;
    } else {
      // 線を 3 つに分ける: 確定前の点まで(実線)/ その点から次の点まで(破線)/ 次の点から先(実線)。曲線の形は、分けても変わらない
      const segs = catmullRom2segments(points);
      const before = pend > 0 ? `<path class="chart-line" d="M${points[0][0]},${points[0][1]}${segs.slice(0, pend).join("")}" ${stroke}/>` : "";
      const dashed = `<path class="chart-line chart-pending-line" d="M${points[pend][0]},${points[pend][1]}${segs[pend]}" ${stroke} stroke-dasharray="5 4"/>`;
      const after = pend + 1 < points.length - 1 ? `<path class="chart-line" d="M${points[pend + 1][0]},${points[pend + 1][1]}${segs.slice(pend + 1).join("")}" ${stroke}/>` : "";
      lines = before + dashed + after;
    }
  } else if (points.length === 1) {
    // 月曜日など、1点だけ(=今日の分しかない)の場合は、ただのドットだと寂しいので
    // 今日の値の高さのまま、半日分だけ左へ伸ばした短い水平線として見せる。
    const [x, y] = points[0];
    const dayWidth = n > 1 ? (W - 2 * padX) / (n - 1) : W / 2;
    const stubStart = Math.max(2, x - dayWidth / 2);
    pathD = `M${stubStart},${y} L${x},${y}`;
    areaD = `${pathD} L${x},${H} L${stubStart},${H} Z`;
    lines = `<path class="chart-line" d="${pathD}" ${stroke}/>`;
  }
  if (pend !== null) {
    const step = (W - 2 * padX) / (n - 1);
    const [px, py] = points[pend];
    const nx = points[pend + 1][0];
    const x0 = Math.max(0, px - step * 0.44), x1 = Math.min(W, nx + step * 0.19);
    const pid = gid + "p";
    pendDefs = `<pattern id="${pid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="var(--ink)" style="stroke-opacity:var(--pend-line-a)" stroke-width="1.5"/></pattern>`;
    // 帯は 2 層: 下に背景色のオーバーレイ(--paper。ライト/ダークそれぞれの背景色)、上に斜線
    pendBand = `<rect class="chart-pending-wash" x="${x0}" y="4" width="${x1 - x0}" height="${H - 8}" fill="var(--paper)" style="fill-opacity:var(--pend-wash-a)"/>`
      + `<rect class="chart-pending-band" x="${x0}" y="4" width="${x1 - x0}" height="${H - 8}" fill="url(#${pid})"/>`;
    pendDot = `<circle class="chart-pending-dot" cx="${px}" cy="${py}" r="5" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/>`;
  }

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}"${pend !== null ? ` role="img" aria-label="週間推移のグラフ。${PENDING_LABEL}の点があります"` : ""}>
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--ink)" stop-opacity="0.18"/>
        <stop offset="100%" stop-color="var(--ink)" stop-opacity="0"/>
      </linearGradient>${pendDefs}</defs>
      ${pend !== null ? `<title>${PENDING_LABEL}</title>` : ""}
      ${areaD ? `<path d="${areaD}" fill="url(#${gid})" stroke="none"/>` : ""}
      ${pendBand}
      ${lines}
      ${pendDot}
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
