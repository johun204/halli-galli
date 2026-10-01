// Web Audio API로 종소리를 직접 합성한다. <audio> 태그 대신 이 방식을 쓰는 이유는
// iOS/Android에서 <audio>/<video> 재생은 보통 기기의 백그라운드 음악(플레이백 세션)을
// 멈추게 만들지만, AudioContext는 기본적으로 다른 소리와 "믹싱"되어 음악을 방해하지 않기 때문.
let ctx: AudioContext | null = null;

const MUTED_KEY = 'halligalli:muted';
let muted = (() => {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
})();

export function isMuted() {
  return muted;
}

/** 소리 끄기/켜기 - 다음 방문에도 유지 */
export function setMuted(next: boolean) {
  muted = next;
  try {
    localStorage.setItem(MUTED_KEY, next ? '1' : '0');
  } catch {
    // 저장이 막힌 브라우저(사생활 보호 모드 등) - 이번 방문 동안만 적용
  }
}

/** 페이지 첫 사용자 상호작용 시 한 번 호출 - 브라우저 자동재생 정책 때문에 필요 */
export function unlockAudio() {
  if (ctx) return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor();
}

export function playBellSound() {
  if (!ctx || muted) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;
  const partials: [number, number][] = [
    [1318.5, 0.28], // 종소리 기본음
    [2637, 0.1], // 배음
  ];
  for (const [freq, peak] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.9);
  }
}
