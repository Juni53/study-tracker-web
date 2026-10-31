// Study Tracker v3 - ポモドーロのフェーズ切り替えの音(Web Audio。音声ファイルは持たず、その場で作る)
//
// 波形は sine。音量は設定(0〜100)。エンベロープは、アタック 0.015秒 のあと、各音の長さの末尾に向けて指数減衰で無音へ。
//   作業→休憩     : 880Hz(0.0s, 0.22s)、659.25Hz(0.2s, 0.45s)           … 下がる2音
//   休憩→作業     : 659.25Hz(0.0s, 0.22s)、880Hz(0.2s, 0.45s)           … 上がる2音
//   作業→長休憩   : 1046.5Hz(0.0s, 0.25s)、783.99Hz(0.25s, 0.25s)、659.25Hz(0.5s, 0.25s)、523.25Hz(0.75s, 1.1s)
// [周波数Hz, 開始秒, 長さ秒]

export const CHIMES = {
  toBreak: [[880, 0.0, 0.22], [659.25, 0.2, 0.45]],
  toWork: [[659.25, 0.0, 0.22], [880, 0.2, 0.45]],
  toLong: [[1046.5, 0.0, 0.25], [783.99, 0.25, 0.25], [659.25, 0.5, 0.25], [523.25, 0.75, 1.1]],
};
export const ATTACK_SEC = 0.015;
export const SILENCE = 0.0001;   // 指数減衰は 0 に届かないので、聞こえない大きさまで下げる
const MAX_PEAK = 0.5;            // 音量100のときの最大の振幅(音が重なるところで割れないように、1より小さく)

// フェーズの変化(from → to)に対応する音。work → short_break / long_break、break → work
export function chimeKindFor(from, to) {
  if (to === "work") return "toWork";
  if (to === "long_break") return "toLong";
  if (to === "short_break") return "toBreak";
  return null;
}

// 音量(0〜100)を、振幅に直す。2乗にして、スライダーの下のほうでも細かく調整できるようにする
export function volumeToPeak(volume) {
  const v = Math.min(100, Math.max(0, Number(volume) || 0)) / 100;
  return MAX_PEAK * v * v;
}

// ctx(AudioContext か、同じ形の偽物)の上に、音を予約する。戻り値は予約した音の数。
export function scheduleChime(ctx, kind, volume, startAt = ctx.currentTime) {
  const notes = CHIMES[kind];
  const peak = volumeToPeak(volume);
  if (!notes || peak <= 0) return 0;
  for (const [freq, offset, dur] of notes) {
    const t0 = startAt + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(SILENCE, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + ATTACK_SEC);                 // アタック
    gain.gain.exponentialRampToValueAtTime(SILENCE, t0 + dur);                // 末尾に向けて指数減衰
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  return notes.length;
}

let sharedCtx = null;
function audioContext() {
  if (sharedCtx) return sharedCtx;
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctor) return null;
  sharedCtx = new Ctor();
  return sharedCtx;
}

// 実際に鳴らす。音を出せない環境(AudioContext が無い等)では何もしない
export async function playChime(kind, volume) {
  try {
    const ctx = audioContext();
    if (!ctx) return 0;
    if (ctx.state === "suspended") await ctx.resume();
    return scheduleChime(ctx, kind, volume);
  } catch (e) {
    console.error(e);
    return 0;
  }
}
