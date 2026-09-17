import { buildDeck, shuffle } from './deck';
import type { BellResult, Card, Fruit, LastFlip, Phase, PublicPlayer, RoomPublicState } from './types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const MIN_TURN_SEC = 5;
export const MAX_TURN_SEC = 30;
export const DEFAULT_TURN_SEC = 10;
const DECK_SIZE = buildDeck().length;

// 최초로 도착한 종으로부터 이만큼 기다렸다가, 모인 종들을 "실제로 누른 시각(서버 기준 보정)" 순으로 판정
const BELL_WINDOW_MS = 500;
// ponytail: 클라이언트가 보낸 보정 시각은 도착 시각 기준 최대 1초 전까지만 믿음(시계 조작/동기화 실패 방어).
// 지연이 이보다 큰 환경까지 보정해야 하면 접속별 실측 RTT로 한도를 잡으면 됨.
const MAX_LAG_MS = 1000;
// 종이 울린 뒤 결과를 보여주며 게임을 멈추는 시간.
const RESULT_PAUSE_MS = 3000;

export interface InternalPlayer {
  id: string;
  name: string;
  secret: string;
  stack: Card[]; // 뒤집을 카드 더미. index 0 = 바닥, 마지막 원소 = 맨 위
  playedPile: Card[]; // 자기 앞에 낸 카드들. 새로 내면 맨 위에 쌓여 이전 카드를 덮음
  isHost: boolean;
  lastActionAt: number | null;
  eliminated: boolean;
}

interface PendingBell {
  playerId: string;
  /** 서버 기준으로 보정된, 실제로 종을 누른 시각 */
  pressedAt: number;
}

/** Durable Object의 storage에 그대로 넣을 수 있는 직렬화 가능한 형태 */
export interface RoomSnapshot {
  code: string;
  phase: Phase;
  players: InternalPlayer[];
  turnOrder: string[];
  currentTurnIndex: number;
  winnerId: string | null;
  flipCounter: number;
  bellCounter: number;
  lastFlip: LastFlip | null;
  lastBellResult: BellResult | null;
  turnTimeLimitMs: number;
}

export class Room {
  code: string;
  phase: Phase = 'lobby';
  players = new Map<string, InternalPlayer>();
  turnOrder: string[] = [];
  currentTurnIndex = 0;
  winnerId: string | null = null;

  // 이번 판(마지막 종 판정 이후) 카드 상태가 바뀐 시각과 그때 5를 만족한 과일 - 늦게 도착한 종을 "누른 순간" 상태로 판정하기 위함
  private conditionLog: { at: number; fruit: Fruit | null }[] = [];
  private pendingBellBuffer: PendingBell[] = [];
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  private flipCounter = 0;
  private bellCounter = 0;
  private lastFlip: LastFlip | null = null;
  private lastBellResult: BellResult | null = null;

  private turnTimeLimitMs = DEFAULT_TURN_SEC * 1000;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;

  private pauseUntil: number | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  // ponytail: 테스트에서만 짧게 오버라이드. 실제 값은 항상 RESULT_PAUSE_MS.
  private resultPauseMs = RESULT_PAUSE_MS;

  // 재접속 시 턴 타이머를 원래 시간으로 되돌리는 걸 이번 턴에 이미 썼는지
  private turnResetUsed = false;

  /** 상태가 바뀔 때마다 호출됨 (Durable Object가 여기서 저장 + 브로드캐스트) */
  onChange: () => void = () => {};
  /** 이 플레이어가 지금 웹소켓으로 접속해 있는지 (Durable Object가 주입) */
  isPlayerConnected: (playerId: string) => boolean = () => true;

  constructor(code: string) {
    this.code = code;
  }

  static fromSnapshot(snap: RoomSnapshot): Room {
    const room = new Room(snap.code);
    room.phase = snap.phase;
    room.players = new Map(snap.players.map((p) => [p.id, p]));
    room.turnOrder = snap.turnOrder;
    room.currentTurnIndex = snap.currentTurnIndex;
    room.winnerId = snap.winnerId;
    room.flipCounter = snap.flipCounter;
    room.bellCounter = snap.bellCounter;
    room.lastFlip = snap.lastFlip;
    room.lastBellResult = snap.lastBellResult;
    room.turnTimeLimitMs = snap.turnTimeLimitMs ?? DEFAULT_TURN_SEC * 1000;
    // ponytail: 하이버네이션 복귀 시 남은 시간을 정확히 복원하진 않고 새 타이머를 시작함
    if (room.phase === 'playing') {
      room.logCondition(true);
      room.scheduleTurnTimer();
    }
    return room;
  }

  toSnapshot(): RoomSnapshot {
    return {
      code: this.code,
      phase: this.phase,
      players: [...this.players.values()],
      turnOrder: this.turnOrder,
      currentTurnIndex: this.currentTurnIndex,
      winnerId: this.winnerId,
      flipCounter: this.flipCounter,
      bellCounter: this.bellCounter,
      lastFlip: this.lastFlip,
      lastBellResult: this.lastBellResult,
      turnTimeLimitMs: this.turnTimeLimitMs,
    };
  }

  /** 대기 중인 타이머를 전부 정리 (테스트 종료 시 / DO가 명시적으로 방을 접을 때 사용) */
  destroy() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.turnTimer = null;
    this.graceTimer = null;
    this.pauseTimer = null;
  }

  /** 방 생성 시점에만 씀 (아직 아무도 없어서 host 검증이 의미 없는 시점) */
  configureTurnLimit(sec: number) {
    const clamped = Math.min(MAX_TURN_SEC, Math.max(MIN_TURN_SEC, Math.round(sec)));
    this.turnTimeLimitMs = clamped * 1000;
  }

  /** 대기실에서 방장이 턴 제한시간을 바꿀 때 씀 */
  updateTurnLimit(playerId: string, sec: number) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('UNAUTHORIZED');
    if (!p.isHost) throw new Error('NOT_HOST');
    if (this.phase !== 'lobby') throw new Error('ALREADY_STARTED');
    this.configureTurnLimit(sec);
    this.onChange();
  }

  addPlayer(name: string): { playerId: string; secret: string } {
    if (this.phase !== 'lobby') throw new Error('ALREADY_STARTED');
    if (this.players.size >= MAX_PLAYERS) throw new Error('ROOM_FULL');
    const id = crypto.randomUUID();
    const secret = crypto.randomUUID();
    const player: InternalPlayer = {
      id,
      name: name.slice(0, 20) || '플레이어',
      secret,
      stack: [],
      playedPile: [],
      isHost: this.players.size === 0,
      lastActionAt: null,
      eliminated: false,
    };
    this.players.set(id, player);
    this.turnOrder.push(id);
    this.onChange();
    return { playerId: id, secret };
  }

  auth(playerId: string, secret: string): InternalPlayer {
    const p = this.players.get(playerId);
    if (!p || p.secret !== secret) throw new Error('UNAUTHORIZED');
    return p;
  }

  /** 최초 시작뿐 아니라 'ended' 상태에서 방장이 다시 누르면 재시작(재초기화) 용도로도 쓰임 */
  start(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('UNAUTHORIZED');
    if (!p.isHost) throw new Error('NOT_HOST');
    if (this.phase !== 'lobby' && this.phase !== 'ended') throw new Error('ALREADY_STARTED');
    if (this.players.size < MIN_PLAYERS) throw new Error('NOT_ENOUGH_PLAYERS');

    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.graceTimer) clearTimeout(this.graceTimer);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.graceTimer = null;
    this.pendingBellBuffer = [];
    this.pauseUntil = null;
    this.winnerId = null;
    this.lastBellResult = null;
    this.lastFlip = null;

    // 매 판마다 앉은 순서를 다시 섞음 (다시 플레이할 때도 한 번 더)
    this.turnOrder = shuffle(this.turnOrder);

    const deck = shuffle(buildDeck());
    const ids = this.turnOrder;
    ids.forEach((id) => {
      const player = this.players.get(id)!;
      player.stack = [];
      player.playedPile = [];
      player.eliminated = false;
    });
    deck.forEach((card, i) => {
      this.players.get(ids[i % ids.length])!.stack.push(card);
    });

    this.currentTurnIndex = 0;
    this.phase = 'playing';
    this.logCondition(true);
    this.beginTurn();
    this.onChange();
  }

  /**
   * 턴마다 제한시간을 걸어둠 - 시간 안에 안 내면 서버가 대신 뒤집어서 게임이 안 멈추게 함.
   * 지금 차례인 사람이 접속이 끊긴 상태면 최소 시간(MIN_TURN_SEC)만 줌 - 재접속하면 원래 시간으로 복구됨.
   */
  private scheduleTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.phase !== 'playing' || this.pauseUntil !== null) {
      this.turnDeadline = null;
      return;
    }
    const currentPlayerId = this.turnOrder[this.currentTurnIndex];
    const limitMs = this.isPlayerConnected(currentPlayerId) ? this.turnTimeLimitMs : MIN_TURN_SEC * 1000;
    this.turnDeadline = Date.now() + limitMs;
    this.turnTimer = setTimeout(() => this.onTurnTimeout(), limitMs);
  }

  /** 새 턴이 시작될 때 호출 - 재접속 시 원래 시간으로 되돌려주는 1회권을 다시 채워줌 */
  private beginTurn() {
    this.turnResetUsed = false;
    this.scheduleTurnTimer();
  }

  /**
   * 접속 상태가 바뀐 사람이 지금 턴 당사자면 타이머를 다시 계산.
   * 끊기면 언제든 최소 시간으로 줄이지만, 원래 시간으로 되돌리는 건 한 턴에 한 번만 허용
   * (새로고침을 계속해서 카운트다운을 무한정 리셋하는 걸 막기 위함).
   */
  reconcileTurnTimerFor(playerId: string) {
    if (this.phase !== 'playing') return;
    if (this.turnOrder[this.currentTurnIndex] !== playerId) return;
    if (this.isPlayerConnected(playerId)) {
      if (this.turnResetUsed) return; // 이번 턴엔 이미 복구권을 썼음 - 지금 진행 중인 카운트다운을 그대로 둠
      this.turnResetUsed = true;
    }
    this.scheduleTurnTimer();
    this.onChange();
  }

  private onTurnTimeout() {
    const playerId = this.turnOrder[this.currentTurnIndex];
    try {
      this.flip(playerId);
    } catch {
      // 종 판정/일시정지 중이라 지금은 못 넘기면 잠시 후 다시 시도
      this.scheduleTurnTimer();
    }
  }

  /** 종이 울린 뒤 결과를 보여주는 동안 턴 타이머를 멈춤. 끝나면 다음 사람 턴을 새 카운트로 시작 */
  private enterResultPause() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnDeadline = null;
    this.pauseUntil = Date.now() + this.resultPauseMs;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => this.exitResultPause(), this.resultPauseMs);
  }

  private exitResultPause() {
    this.pauseTimer = null;
    this.pauseUntil = null;
    if (this.phase === 'playing') {
      this.logCondition(true); // 결과 표시 중에 누른 종이 늦게 도착해도 새 판에 섞이지 않게 기록을 새로 시작
      this.beginTurn();
    }
    this.onChange();
  }

  /** 각자 지금 내놓은(맨 위) 카드만 보고 같은 과일끼리 합산해 정확히 5인지 판정 */
  private evaluateCondition(): { valid: boolean; fruit: Fruit | null; sum: number } {
    const sums = new Map<Fruit, number>();
    for (const player of this.players.values()) {
      const top = player.playedPile.at(-1);
      if (!top) continue;
      sums.set(top.fruit, (sums.get(top.fruit) ?? 0) + top.count);
    }
    for (const [fruit, sum] of sums) {
      if (sum === 5) return { valid: true, fruit, sum };
    }
    return { valid: false, fruit: null, sum: 0 };
  }

  /** 지금 카드 상태를 시각과 함께 기록. reset이면 이전 판 기록을 버리고 새로 시작 */
  private logCondition(reset = false) {
    if (reset) this.conditionLog = [];
    this.conditionLog.push({ at: Date.now(), fruit: this.evaluateCondition().fruit });
  }

  /** 서버 시각 t에 5를 만족하던 과일(없으면 null). t가 이번 판 시작 전이면 undefined */
  private fruitAt(t: number): Fruit | null | undefined {
    let fruit: Fruit | null | undefined;
    for (const mark of this.conditionLog) {
      if (mark.at > t) break;
      fruit = mark.fruit;
    }
    return fruit;
  }

  /**
   * 다음 턴을 정함. startOffset=1이면 "다음 사람부터"(방금 낸 사람은 건너뜀),
   * startOffset=0이면 "지금 배정된 사람부터 다시 검증"(카드 이동으로 지금 턴 사람이 0장이 됐을 수도 있으므로).
   * 카드가 0장인 채로 자기 차례가 오는 사람은 여기서 탈락 처리됨.
   */
  private syncTurn(startOffset: 0 | 1) {
    const n = this.turnOrder.length;
    for (let i = startOffset; i < startOffset + n; i++) {
      const idx = (this.currentTurnIndex + i) % n;
      const pid = this.turnOrder[idx];
      const player = this.players.get(pid)!;
      if (player.eliminated) continue;
      if (player.stack.length > 0) {
        this.currentTurnIndex = idx;
        return;
      }
      player.eliminated = true;
      if (this.checkSoleSurvivorWin()) return;
    }
  }

  /** 탈락자를 빼고 한 명만 남으면 그 사람 승리로 즉시 게임 종료 */
  private checkSoleSurvivorWin(): boolean {
    if (this.phase !== 'playing') return false;
    const active = this.turnOrder.map((id) => this.players.get(id)!).filter((pl) => !pl.eliminated);
    if (active.length !== 1) return false;
    this.phase = 'ended';
    this.winnerId = active[0].id;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.turnDeadline = null;
    this.pauseUntil = null;
    return true;
  }

  flip(playerId: string) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('UNAUTHORIZED');
    if (player.eliminated) throw new Error('ELIMINATED');
    if (this.phase !== 'playing') throw new Error('NOT_PLAYING');
    if (this.graceTimer) throw new Error('BELL_WINDOW_OPEN');
    if (this.pauseUntil !== null) throw new Error('GAME_PAUSED');
    if (this.turnOrder[this.currentTurnIndex] !== playerId) throw new Error('NOT_YOUR_TURN');
    if (player.stack.length === 0) throw new Error('NO_CARDS');

    const card = player.stack.pop()!;
    player.playedPile.push(card); // 이전에 낸 카드는 덮여서 계산 대상에서 사라짐
    player.lastActionAt = Date.now();
    this.lastFlip = { playerId, at: Date.now(), resultId: ++this.flipCounter };
    this.logCondition();

    // 턴은 종 여부와 무관하게 계속 진행됨 (실제 할리갈리처럼 - 아무도 안 치면 그냥 다음 사람이 계속 냄)
    this.syncTurn(1);
    this.beginTurn();
    this.onChange();
  }

  /**
   * 종치기는 도착 즉시 판정하지 않고 모아둠. 최초 도착 후 BELL_WINDOW_MS 뒤에 누른 시각 순으로 한꺼번에 판정해서
   * 서버와 가까운(지연이 적은) 사람이 도착 순서만으로 유리해지지 않게 함.
   */
  bell(playerId: string, correctedServerTime: number) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('UNAUTHORIZED');
    if (player.eliminated) throw new Error('ELIMINATED');
    if (this.phase !== 'playing') throw new Error('NOT_PLAYING');
    if (this.pauseUntil !== null) throw new Error('GAME_PAUSED');
    const now = Date.now();
    player.lastActionAt = now;

    // 미래 시각은 불가능, 너무 먼 과거는 조작/동기화 실패로 보고 잘라냄
    const pressedAt = Number.isFinite(correctedServerTime)
      ? Math.min(now, Math.max(now - MAX_LAG_MS, correctedServerTime))
      : now;
    if (this.fruitAt(pressedAt) === undefined) return; // 이번 판 시작 전(결과 표시 중)에 누른 종이 늦게 도착 - 무시
    if (this.pendingBellBuffer.some((b) => b.playerId === playerId)) return; // 한 판정에 한 사람당 한 번만

    this.pendingBellBuffer.push({ playerId, pressedAt });
    if (!this.graceTimer) this.graceTimer = setTimeout(() => this.resolveBellRound(), BELL_WINDOW_MS);
  }

  /** 페널티 대상의 여유 카드를 다른 사람들에게 1장씩 나눠줌 */
  private giveAwayCards(penalizedId: string) {
    const penalized = this.players.get(penalizedId);
    if (!penalized) return;
    for (const otherId of this.turnOrder) {
      if (otherId === penalizedId) continue;
      if (penalized.stack.length === 0) break;
      const card = penalized.stack.shift()!;
      this.players.get(otherId)!.stack.unshift(card);
    }
  }

  private finishAsFalseRing(penalizedId: string) {
    this.giveAwayCards(penalizedId);
    this.lastBellResult = {
      id: ++this.bellCounter,
      winnerId: null,
      penalizedIds: [penalizedId],
      tookCards: 0,
      contributorIds: [],
      fruit: null,
      at: Date.now(),
    };
    this.syncTurn(0); // 턴은 종 여부와 무관하게 이미 진행 중이었으므로 지금 배정된 사람만 재검증
    if (this.phase === 'playing') this.enterResultPause();
    this.onChange();
  }

  /** 종을 정확히 맞춘 사람 - 모든 사람 앞에 쌓여있던(덮인 것 포함) 카드를 전부 걷어감 */
  private finishAsWin(winnerId: string, fruit: Fruit) {
    const winner = this.players.get(winnerId)!;
    let taken: Card[] = [];
    const contributorIds: string[] = [];
    for (const [pid, player] of this.players) {
      if (player.playedPile.length > 0) contributorIds.push(pid);
      taken = taken.concat(player.playedPile);
      player.playedPile = [];
    }
    winner.stack = [...taken, ...winner.stack];
    this.lastBellResult = {
      id: ++this.bellCounter,
      winnerId,
      penalizedIds: [],
      tookCards: taken.length,
      contributorIds,
      fruit,
      at: Date.now(),
    };
    if (winner.stack.length === DECK_SIZE) {
      this.phase = 'ended';
      this.winnerId = winnerId;
      if (this.turnTimer) clearTimeout(this.turnTimer);
      this.turnDeadline = null;
    } else {
      this.syncTurn(0); // 턴은 이미 계속 진행 중이었으므로 지금 배정된 사람만 재검증
      if (this.phase === 'playing') this.enterResultPause();
    }
    this.onChange();
  }

  private resolveBellRound() {
    this.graceTimer = null;
    // 도착 순서가 아니라 보정된 "누른 시각" 순. 동시각이면 먼저 도착한 쪽
    const bells = this.pendingBellBuffer.sort((a, b) => a.pressedAt - b.pressedAt);
    this.pendingBellBuffer = [];
    if (bells.length === 0) return;

    // 각자 누른 그 순간의 카드 상태로 판정 - 그 사이 다른 사람이 카드를 내서 상태가 바뀌었어도 영향 없음
    const winnerIdx = bells.findIndex((b) => this.fruitAt(b.pressedAt));
    if (winnerIdx !== -1) {
      const winner = bells[winnerIdx];
      // 정답자보다 먼저 잘못 친 사람만 벌칙(조용히 카드만 이동). 정답자보다 늦게 친 종은 무효
      for (const b of bells.slice(0, winnerIdx)) this.giveAwayCards(b.playerId);
      this.finishAsWin(winner.playerId, this.fruitAt(winner.pressedAt)!);
      return;
    }

    // 아무도 못 맞췄으면 전원 벌칙, 결과 표시는 가장 먼저 친 사람 기준
    for (const b of bells.slice(1)) this.giveAwayCards(b.playerId);
    this.finishAsFalseRing(bells[0].playerId);
  }

  toPublicState(connectedIds: ReadonlySet<string>): RoomPublicState {
    const now = Date.now();
    const players: PublicPlayer[] = this.turnOrder.map((id) => {
      const p = this.players.get(id)!;
      return {
        id: p.id,
        name: p.name,
        cardCount: p.stack.length,
        connected: connectedIds.has(id),
        isHost: p.isHost,
        lastActionAt: p.lastActionAt,
        playedTop: p.playedPile.at(-1) ?? null,
        playedCount: p.playedPile.length,
        eliminated: p.eliminated,
      };
    });
    return {
      code: this.code,
      phase: this.phase,
      players,
      currentTurnPlayerId: this.phase === 'playing' ? this.turnOrder[this.currentTurnIndex] : null,
      lastBellResult: this.lastBellResult,
      lastFlip: this.lastFlip,
      winnerId: this.winnerId,
      serverTime: now,
      turnTimeLimitSec: this.turnTimeLimitMs / 1000,
      turnDeadline: this.turnDeadline,
      paused: this.pauseUntil !== null,
    };
  }
}
