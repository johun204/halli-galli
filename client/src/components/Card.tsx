import type { Card as CardType, Fruit } from '../../../shared/types';

const FRUIT_STYLE: Record<Fruit, { emoji: string; color: string }> = {
  strawberry: { emoji: '🍓', color: '#e6392f' },
  banana: { emoji: '🍌', color: '#e0a716' },
  lime: { emoji: '🍏', color: '#5a9e2f' },
  plum: { emoji: '🍇', color: '#7e57c2' },
};

// 실제 할리갈리 카드처럼 주사위 눈 모양으로 배치 (3x3 격자의 [행, 열])
const PIP_LAYOUT: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
};

export function CardFace({ card }: { card: CardType }) {
  const style = FRUIT_STYLE[card.fruit];
  return (
    <div className="card-face" style={{ borderColor: style.color }}>
      <div className="card-face-grid" style={{ color: style.color }}>
        {PIP_LAYOUT[card.count]?.map(([row, col], i) => (
          <span key={i} style={{ gridRow: row, gridColumn: col }}>
            {style.emoji}
          </span>
        ))}
      </div>
      <div className="card-face-count" style={{ background: style.color }}>
        {card.count}
      </div>
    </div>
  );
}

export function CardBack() {
  return (
    <div className="card-back">
      <div className="card-back-bell">🔔</div>
    </div>
  );
}

/**
 * 자기 앞에 낸 카드 - 뒷면이 보이는 채로 나왔다가 아래쪽으로 뒤집히며(위 모서리가 앞으로 넘어오며) 앞면이 펼쳐지는 3D 효과.
 * card가 null이면 뒷면만 보여줌 (내가 낸 카드의 서버 응답을 기다리는 중). 새 카드마다 key를 바꿔 다시 마운트해야 애니메이션이 재생됨
 */
export function FlipCard({ card }: { card: CardType | null }) {
  return (
    <div className="flip3d">
      <div className={`flip3d-inner ${card ? 'flip3d-reveal' : 'flip3d-waiting'}`}>
        <div className="flip3d-side flip3d-front">{card && <CardFace card={card} />}</div>
        <div className="flip3d-side flip3d-back">
          <CardBack />
        </div>
      </div>
      <div className={`flip3d-shadow ${card ? 'flip3d-shadow-reveal' : ''}`} />
    </div>
  );
}
