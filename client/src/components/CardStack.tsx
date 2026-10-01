import { useEffect, useRef, useState } from 'react';
import { CardBack } from './Card';

// 이만큼 위로 끌어올리면 놓는 순간 카드를 냄
const DRAG_THRESHOLD = 40;
// 짧게 끌었어도 이 속도(px/ms) 이상으로 휙 밀어 올리면 냄 (실제로 카드를 툭 밀어내는 느낌)
const FLICK_VELOCITY = 0.3;
const FLICK_MIN_DISTANCE = 14;
const MAX_DRAG = 140;
const FLY_MS = 240;

export function CardStack({
  cardCount,
  canFlip,
  onFlip,
  label,
}: {
  cardCount: number;
  canFlip: boolean;
  onFlip: () => void;
  label: string;
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [flying, setFlying] = useState(false);
  // 포인터 이벤트는 렌더보다 자주 오므로 판정에 쓰는 값은 ref로 들고 있음 (state는 그리기용)
  const pointer = useRef<{ id: number; startX: number; startY: number; lastY: number; lastT: number; vy: number } | null>(
    null,
  );
  const dragRef = useRef({ x: 0, y: 0 });
  const flyTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(flyTimer.current), []);

  const thickness = Math.min(cardCount, 6);
  const active = canFlip && cardCount > 0;

  // 차례가 끝나면(다른 사람 차례 / 판정 중) 끌던 카드를 제자리로
  useEffect(() => {
    if (active) return;
    pointer.current = null;
    setDragging(false);
    dragRef.current = { x: 0, y: 0 };
    setDrag({ x: 0, y: 0 });
  }, [active]);

  function onPointerDown(e: React.PointerEvent) {
    if (!active || flying || pointer.current) return;
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointer.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, vy: 0 };
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - p.lastT);
    // 위쪽(음수) 속도만 보고, 최근 움직임에 가중치를 줘서 손을 놓기 직전의 속도를 씀
    p.vy = p.vy * 0.4 + ((e.clientY - p.lastY) / dt) * 0.6;
    p.lastY = e.clientY;
    p.lastT = e.timeStamp;

    const rawY = Math.min(0, e.clientY - p.startY);
    // 끝까지 끌면 살짝 고무줄처럼 저항
    const y = rawY < -MAX_DRAG ? -MAX_DRAG - (-rawY - MAX_DRAG) * 0.2 : rawY;
    const x = Math.max(-40, Math.min(40, (e.clientX - p.startX) * 0.5));
    dragRef.current = { x, y };
    setDrag({ x, y });
  }

  function endDrag(e: React.PointerEvent, cancelled = false) {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    setDragging(false);
    const { y } = dragRef.current;
    const flicked = -p.vy >= FLICK_VELOCITY && -y >= FLICK_MIN_DISTANCE;
    if (!cancelled && (y <= -DRAG_THRESHOLD || flicked)) {
      if (navigator.vibrate) navigator.vibrate(12);
      setFlying(true);
      onFlip();
      flyTimer.current = setTimeout(() => {
        setFlying(false);
        dragRef.current = { x: 0, y: 0 };
        setDrag({ x: 0, y: 0 });
      }, FLY_MS);
    } else {
      dragRef.current = { x: 0, y: 0 };
      setDrag({ x: 0, y: 0 });
    }
  }

  // 끌어올린 정도(0~1) - 기준선에 다다르면 카드가 살짝 밝아져서 "놓으면 나간다"는 걸 알려줌
  const progress = Math.min(1, -drag.y / DRAG_THRESHOLD);

  return (
    <div className="card-stack-wrap">
      <div
        className={`card-stack ${active ? 'card-stack-active' : ''}`}
        style={{ height: 106 + thickness * 3 }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endDrag(e)}
        onPointerCancel={(e) => endDrag(e, true)}
      >
        {active && !dragging && !flying && <DragGuide />}
        {Array.from({ length: thickness }).map((_, i) => (
          <div
            key={i}
            className="stack-layer"
            style={{ transform: `translate(${i * -0.6}px, ${-i * 3}px)`, zIndex: i }}
          />
        ))}
        {cardCount > 0 && (
          <div
            className={[
              'stack-top',
              flying ? 'stack-top-flying' : '',
              active ? 'draggable' : '',
              dragging ? 'stack-top-dragging' : '',
              progress >= 1 ? 'stack-top-ready' : '',
            ].join(' ')}
            style={{
              zIndex: thickness + 1,
              transform: flying
                ? undefined
                : `translate(${drag.x}px, ${drag.y - thickness * 3}px) rotate(${drag.x / 5}deg) scale(${1 + progress * 0.08})`,
            }}
          >
            {/* 살짝 들썩이는 안내 애니메이션은 안쪽에 걸어야 끌기 위치(인라인 transform)와 안 부딪힘 */}
            <div className={active && !dragging && !flying ? 'stack-top-nudge' : ''}>
              <CardBack />
            </div>
          </div>
        )}
      </div>
      <div className="card-stack-label">
        {label} · {cardCount}장
      </div>
    </div>
  );
}

/** 내 차례일 때 카드 위로 천천히 올라가는 옅은 화살표 - "위로 밀어서 내세요" 안내 */
function DragGuide() {
  return (
    <div className="drag-guide" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <svg key={i} className="drag-guide-chevron" viewBox="0 0 40 16" style={{ animationDelay: `${i * 0.28}s` }}>
          <path d="M4 13 L20 3 L36 13" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ))}
      <span className="drag-guide-text">위로 밀어서 내기</span>
    </div>
  );
}
