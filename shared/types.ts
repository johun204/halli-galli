// 서버(worker)와 클라이언트(client)가 함께 쓰는 타입/상수 - 한쪽만 고치면 어긋나므로 여기서만 정의

export const MAX_PLAYERS = 6;
export const MIN_TURN_SEC = 5;
export const MAX_TURN_SEC = 30;
export const REACTIONS = ['😄', '😛', '😭', '🥱', '😱', '🤬'] as const;

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
  /** 누군가 종을 쳐서 판정을 기다리는 중인지 (최초 도착 후 500ms) */
  bellPending: boolean;
  /** 초대코드 없이 랜덤 매칭으로 모르는 사람도 들어올 수 있는 방인지 (방장이 대기실에서 켜고 끔) */
  isPublic: boolean;
}

export type ReactionEmoji = (typeof REACTIONS)[number];

// 서버 <-> 클라이언트 웹소켓 메시지 프로토콜
export type ClientMessage =
  | { type: 'start' }
  | { type: 'flip' }
  /**
   * seenFlipId: 종을 누른 순간 내 화면에 반영돼 있던 마지막 카드(lastFlip.resultId, 없으면 0)
   * shownAgoMs: 최근 카드들이 내 화면에 그려진 지 몇 ms 지났는지 { [flipId]: ms } - 반응시간 판정용 (기기 안에서 잰 값이라 시계 오차 없음)
   */
  | { type: 'bell'; correctedServerTime: number; seenFlipId: number; shownAgoMs?: Record<string, number> }
  | { type: 'emoji'; emoji: ReactionEmoji }
  | { type: 'setTurnLimit'; sec: number }
  | { type: 'setPublic'; isPublic: boolean }
  | { type: 'leave' }
  /** 시계 동기화: 클라이언트가 보낸 시각 t를 서버가 pong으로 돌려줌 */
  | { type: 'ping'; t: number }
  /** pong을 받자마자 서버 시각 s를 되돌려 보내서 서버가 왕복지연을 직접 잴 수 있게 함 */
  | { type: 'clockAck'; s: number };

export type ServerMessage =
  | { type: 'state'; room: RoomPublicState }
  | { type: 'error'; error: string }
  | { type: 'emoji'; id: number; playerId: string; emoji: ReactionEmoji }
  | { type: 'pong'; t: number; s: number };

// 랜덤 매칭 웹소켓(/api/match/ws) 프로토콜 - 서버 -> 클라이언트만 있음 (클라이언트는 연결을 끊는 것으로 취소)
export type MatchServerMessage =
  /** 아직 매칭 대기 중. waiting = 지금 나를 포함해 매칭을 기다리는 사람 수 */
  | { type: 'waiting'; waiting: number }
  /** 방에 들어감 - 이 신원으로 /room/:code 에 접속하면 됨 */
  | { type: 'matched'; code: string; playerId: string; secret: string }
  | { type: 'error'; error: string };

/** 방(Room DO) -> 매칭 서버(Matchmaker DO)로 보내는 공개 방 현황. 공개가 아니거나 방이 사라지면 null */
export interface PublicRoomSummary {
  code: string;
  phase: Phase;
  playerCount: number;
  connectedCount: number;
  /** 보낸 시각 - 순서가 뒤바뀌어 도착한 오래된 보고를 버리기 위함 */
  at: number;
}
