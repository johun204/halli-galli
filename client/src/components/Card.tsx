import type { Card as CardType, Fruit } from '../types';

const FRUIT_STYLE: Record<Fruit, { emoji: string; color: string }> = {
  strawberry: { emoji: '🍓', color: '#e6392f' },
  banana: { emoji: '🍌', color: '#e0a716' },
  lime: { emoji: '🍏', color: '#5a9e2f' },
  plum: { emoji: '🍇', color: '#7e57c2' },
};

export function CardFace({ card }: { card: CardType }) {
  const style = FRUIT_STYLE[card.fruit];
  return (
    <div className="card-face" style={{ borderColor: style.color }}>
      <div className="card-face-grid" style={{ color: style.color }}>
        {Array.from({ length: card.count }).map((_, i) => (
          <span key={i}>{style.emoji}</span>
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
