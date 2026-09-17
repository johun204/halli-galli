export type Fruit = 'strawberry' | 'lime' | 'banana' | 'plum';

export interface Card {
  id: string;
  fruit: Fruit;
  count: number;
}

export type Phase = 'lobby' | 'playing' | 'ended';

export interface PublicPlayer {
  id: string;
  name: string;
  cardCount: number;
  connected: boolean;
  isHost: boolean;
  lastActionAt: number | null;
  /** 이 사람이 지금 자기 앞에 낸 카드 (새로 내면 이전 카드는 덮여서 사라짐) */
  playedTop: Card | null;
  /** 덮여있는 카드까지 포함한 장수 (두께감 표현용) */
  playedCount: number;
  /** 카드가 0장인 채로 자기 차례가 와서 더 낼 수 없게 되어 게임에서 빠진 사람 */
  eliminated: boolean;
}

export interface BellResult {
  id: number;
  winnerId: string | null;
  penalizedIds: string[];
  tookCards: number;
  /** 승리 시: 실제로 카드를 내놓은 상태였던 플레이어 id들 (빈 사람은 이펙트 대상에서 제외) */
  contributorIds: string[];
  /** 승리 시 맞춘 과일 종류. 오답(false ring)이면 null */
  fruit: Fruit | null;
  at: number;
}

export interface LastFlip {
  playerId: string;
  at: number;
  resultId: number;
}

export interface RoomPublicState {
  code: string;
  phase: Phase;
  players: PublicPlayer[];
  currentTurnPlayerId: string | null;
  lastBellResult: BellResult | null;
  lastFlip: LastFlip | null;
  winnerId: string | null;
  serverTime: number;
  turnTimeLimitSec: number;
  /** 현재 턴이 자동으로 넘어가는 서버 기준 시각(ms). 턴이 없으면 null */
  turnDeadline: number | null;
  /** 종이 울린 직후 결과를 보여주며 게임이 잠시 멈춰있는 중인지 */
  paused: boolean;
}

export type ReactionEmoji = '😄' | '😛' | '😭' | '🥱' | '😱' | '🤬';

// 서버 <-> 클라이언트 웹소켓 메시지 프로토콜
export type ClientMessage =
  | { type: 'start' }
  | { type: 'flip' }
  | { type: 'bell'; correctedServerTime: number }
  | { type: 'emoji'; emoji: ReactionEmoji }
  | { type: 'setTurnLimit'; sec: number };

export type ServerMessage =
  | { type: 'state'; room: RoomPublicState }
  | { type: 'error'; error: string }
  | { type: 'emoji'; id: number; playerId: string; emoji: ReactionEmoji };
