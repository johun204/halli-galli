import type { Card, Fruit } from '../../shared/types';

const FRUITS: Fruit[] = ['strawberry', 'lime', 'banana', 'plum'];

// 공식 할리갈리 카드 구성: 과일당 1개 5장, 2개 3장, 3개 3장, 4개 2장, 5개 1장 (14장 x 4종 = 56장)
const COUNT_DISTRIBUTION: { count: number; copies: number }[] = [
  { count: 1, copies: 5 },
  { count: 2, copies: 3 },
  { count: 3, copies: 3 },
  { count: 4, copies: 2 },
  { count: 5, copies: 1 },
];

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  let idCounter = 0;
  for (const fruit of FRUITS) {
    for (const { count, copies } of COUNT_DISTRIBUTION) {
      for (let i = 0; i < copies; i++) {
        deck.push({ id: `c${idCounter++}`, fruit, count });
      }
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[], rng: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
