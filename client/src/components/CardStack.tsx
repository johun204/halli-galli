import { useRef, useState } from 'react';
import { CardBack } from './Card';

const DRAG_THRESHOLD = 55;
const MAX_DRAG = 130;

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
  const [dragY, setDragY] = useState(0);
  const [flying, setFlying] = useState(false);
  const dragging = useRef(false);
  const startY = useRef(0);

  const thickness = Math.min(cardCount, 6);

  function onPointerDown(e: React.PointerEvent) {
    if (!canFlip || cardCount === 0) return;
    dragging.current = true;
    startY.current = e.clientY;
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging.current) return;
    const delta = Math.min(0, e.clientY - startY.current);
    setDragY(Math.max(-MAX_DRAG, delta));
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragY <= -DRAG_THRESHOLD) {
      setFlying(true);
      onFlip();
      setTimeout(() => {
        setFlying(false);
        setDragY(0);
      }, 260);
    } else {
      setDragY(0);
    }
  }

  return (
    <div className="card-stack-wrap">
      <div className="card-stack" style={{ height: 64 + thickness * 3 }}>
        {Array.from({ length: thickness }).map((_, i) => (
          <div
            key={i}
            className="stack-layer"
            style={{ transform: `translate(${i * -0.6}px, ${-i * 3}px)`, zIndex: i }}
          />
        ))}
        {cardCount > 0 && (
          <div
            className={`stack-top ${flying ? 'stack-top-flying' : ''} ${canFlip ? 'draggable' : ''}`}
            style={{
              zIndex: thickness + 1,
              transform: `translateY(${dragY}px) rotate(${dragY / 6}deg) scale(${1 + dragY / -900})`,
              transition: dragging.current ? 'none' : undefined,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <CardBack />
          </div>
        )}
      </div>
      <div className="card-stack-label">
        {label} · {cardCount}장
      </div>
      {canFlip && cardCount > 0 && <div className="card-stack-hint">위로 밀어서 뒤집기</div>}
    </div>
  );
}
