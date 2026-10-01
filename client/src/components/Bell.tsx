import { useRef, useState } from 'react';

// 누른 느낌(꾹 눌림)을 보여주는 시간. :active는 모바일에서 늦게/안 걸리는 경우가 있어 직접 상태로 처리
const PRESS_MS = 140;

/**
 * 할리갈리 종 - 테이블에 앉아서 비스듬히 내려다본 모습(받침대 + 크롬 돔 + 누르는 손잡이).
 * 종이 언제 울릴지 알려주는 힌트는 일부러 없음 - 판단은 플레이어의 몫
 */
export function Bell({ onRing }: { onRing: () => void }) {
  const [pressed, setPressed] = useState(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>();

  function handlePress(e: React.PointerEvent) {
    e.preventDefault();
    if (navigator.vibrate) navigator.vibrate(30);
    setPressed(true);
    clearTimeout(releaseTimer.current);
    releaseTimer.current = setTimeout(() => setPressed(false), PRESS_MS);
    onRing();
  }

  return (
    <button
      className={`bell ${pressed ? 'bell-pressed' : ''}`}
      onPointerDown={handlePress}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="종 치기"
    >
      <BellArt />
    </button>
  );
}

function BellArt() {
  return (
    <svg viewBox="0 0 120 104" className="bell-svg" aria-hidden="true">
      <defs>
        <radialGradient id="bell-dome" cx="38%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#eef1f4" />
          <stop offset="55%" stopColor="#aab2bb" />
          <stop offset="80%" stopColor="#6e7781" />
          <stop offset="100%" stopColor="#4a525b" />
        </radialGradient>
        <linearGradient id="bell-dome-band" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#3d444c" stopOpacity="0.55" />
          <stop offset="18%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="70%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#2b3138" stopOpacity="0.6" />
        </linearGradient>
        <linearGradient id="bell-base-side" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="35%" stopColor="#3a3a3a" />
          <stop offset="60%" stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#0e0e0e" />
        </linearGradient>
        <radialGradient id="bell-base-top" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#4a4a4a" />
          <stop offset="100%" stopColor="#1c1c1c" />
        </radialGradient>
        <linearGradient id="bell-knob" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#5c646d" />
          <stop offset="35%" stopColor="#f4f6f8" />
          <stop offset="65%" stopColor="#b5bcc4" />
          <stop offset="100%" stopColor="#4a525b" />
        </linearGradient>
        <radialGradient id="bell-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 테이블에 드리운 그림자 */}
      <ellipse cx="60" cy="90" rx="56" ry="13" fill="url(#bell-shadow)" />

      {/* 받침대 (검은 원판): 옆면 + 윗면 */}
      <path d="M12 76 L12 84 A48 11 0 0 0 108 84 L108 76 Z" fill="url(#bell-base-side)" />
      <ellipse cx="60" cy="76" rx="48" ry="11" fill="url(#bell-base-top)" />
      <ellipse cx="60" cy="76" rx="47" ry="10.4" fill="none" stroke="#5a5a5a" strokeWidth="0.8" opacity="0.7" />

      {/* 누르면 같이 살짝 눌리는 돔 + 손잡이 */}
      <g className="bell-press-group">
        {/* 돔 아래 그림자 (받침대 위) */}
        <ellipse cx="60" cy="74.5" rx="38" ry="7.5" fill="#000" opacity="0.45" />
        {/* 크롬 돔 */}
        <path d="M23 72 C23 47 39 32 60 32 C81 32 97 47 97 72 A37 8 0 0 1 23 72 Z" fill="url(#bell-dome)" />
        <path d="M23 72 C23 47 39 32 60 32 C81 32 97 47 97 72 A37 8 0 0 1 23 72 Z" fill="url(#bell-dome-band)" />
        {/* 돔 테두리(앞쪽 림)의 반사광 */}
        <path d="M23.5 72 A36.5 7.6 0 0 0 96.5 72" fill="none" stroke="#e9edf1" strokeWidth="1.6" opacity="0.9" />
        <path d="M25 74.2 A35 6.6 0 0 0 95 74.2" fill="none" stroke="#3a4048" strokeWidth="1" opacity="0.6" />
        {/* 하이라이트 */}
        <ellipse cx="45" cy="47" rx="9" ry="5" fill="#fff" opacity="0.85" transform="rotate(-28 45 47)" />
        <ellipse cx="78" cy="60" rx="3" ry="7" fill="#fff" opacity="0.25" transform="rotate(-18 78 60)" />

        {/* 손잡이 기둥 + 누르는 꼭지 */}
        <g className="bell-knob">
          <rect x="57" y="22" width="6" height="12" fill="url(#bell-knob)" />
          <path d="M50 16 L50 21 A10 4 0 0 0 70 21 L70 16 Z" fill="url(#bell-knob)" />
          <ellipse cx="60" cy="16" rx="10" ry="4" fill="#f7f9fb" />
          <ellipse cx="57" cy="15.2" rx="4" ry="1.4" fill="#fff" />
        </g>
      </g>
    </svg>
  );
}
