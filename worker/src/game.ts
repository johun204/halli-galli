import { buildDeck, shuffle } from './deck';
import { MAX_PLAYERS, MAX_TURN_SEC, MIN_TURN_SEC } from '../../shared/types';
import type { BellResult, Card, Fruit, LastFlip, Phase, PublicPlayer, RoomPublicState } from '../../shared/types';

export { MAX_PLAYERS, MAX_TURN_SEC, MIN_TURN_SEC };
export const MIN_PLAYERS = 2;
export const DEFAULT_TURN_SEC = 10;
const DECK_SIZE = buildDeck().length;

// 최초로 도착한 종으로부터 최소 이만큼 기다렸다가 모인 종들을 한꺼번에 판정
const BELL_WINDOW_MS = 500;
// 느린 사람은 카드가 늦게 오고(단방향) 종도 늦게 도착(단방향) = 왕복지연만큼 더 늦음. 그만큼 더 기다려주되 이 이상은 안 기다림
const BELL_WINDOW_MAX_MS = 1500;
// 반응시간 하한을 계산할 때 봐주는 여유 (화면 그리기 + 네트워크 흔들림).
// 종이 서버에 도착한 시각은 조작할 수 없으므로: 반응시간 >= (도착 - 카드가 나온 시각) - 왕복지연 - 이만큼
const SHOWN_MARGIN_MS = 80;
// 클라이언트가 보낸 보정 시각은 도착 시각 기준 최대 1초 전까지만 믿음(시계 조작/동기화 실패 방어)
const MAX_LAG_MS = 1000;
// ponytail: 사람이 카드를 보고 종을 치기까지 걸리는 최소 시간을 고정값으로 가정. 이보다 빨리 눌렀다는 주장은 잘라냄(조작 방지)
const MIN_REACTION_MS = 80;
// 화면이 서버보다 늦게 바뀌는 걸 인정해주는 여유 = 그 사람의 왕복지연 + 이만큼
const STALE_MARGIN_MS = 100;
// 서버가 잰 왕복지연은 최근 몇 개 샘플 중 최솟값을 씀 (일시적인 튐 무시)
const RTT_SAMPLES = 5;
// 카드가 0장인 사람에게 차례가 오면 바로 탈락시키지 않고, 앞사람 카드에 종을 칠 수 있게 이만큼 기다림
const OUT_OF_CARDS_GRACE_MS = 2000;
// 방장이 이만큼 접속이 끊겨 있으면 접속 중인 다음 사람에게 방장을 넘김
const HOST_TRANSFER_MS = 10_000;
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
  /** 누른 순간 그 사람 화면의 카드 상태에서 5를 만족하던 과일 (없으면 null = 오답) */
  fruit: Fruit | null;
  /** 정답일 때: 그 사람 화면에 5가 처음 보인 순간부터 종을 누르기까지 걸린 시간(ms). 오답이면 Infinity */
  reactionMs: number;
}

/** 카드 상태가 바뀐 시점 기록. flipId = 그 시점의 lastFlip.resultId (클라이언트가 보낸 seenFlipId와 맞춰봄) */
interface ConditionMark {
  at: number;
  flipId: number;
  fruit: Fruit | null;
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
  isPublic?: boolean;
}

export class Room {
  code: string;
  phase: Phase = 'lobby';
  players = new Map<string, InternalPlayer>();
  turnOrder: string[] = [];
  currentTurnIndex = 0;
  winnerId: string | null = null;
  /** 초대코드 없이 랜덤 매칭으로 들어올 수 있는 방인지 */
  isPublic = false;

  // 이번 판(마지막 종 판정 이후) 카드 상태 변화 기록 - 늦게 도착한 종을 "누른 순간 그 사람 화면" 기준으로 판정하기 위함
  private conditionLog: ConditionMark[] = [];
  private pendingBellBuffer: PendingBell[] = [];
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private rttSamples = new Map<string, number[]>();

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

  private hostTimer: ReturnType<typeof setTimeout> | null = null;

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
    room.isPublic = snap.isPublic ?? false;
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
      isPublic: this.isPublic,
    };
  }

  /** 대기 중인 타이머를 전부 정리 (테스트 종료 시 / DO가 방을 비울 때 사용) */
  destroy() {
    for (const t of [this.turnTimer, this.graceTimer, this.pauseTimer, this.hostTimer]) if (t) clearTimeout(t);
    this.turnTimer = null;
    this.graceTimer = null;
    this.pauseTimer = null;
    this.hostTimer = null;
  }

  /** 방 생성 시점에만 씀 (아직 아무도 없어서 host 검증이 의미 없는 시점). 숫자가 아니면 무시 */
  configureTurnLimit(sec: unknown) {
    if (typeof sec !== 'number' || !Number.isFinite(sec)) return;
    const clamped = Math.min(MAX_TURN_SEC, Math.max(MIN_TURN_SEC, Math.round(sec)));
    this.turnTimeLimitMs = clamped * 1000;
  }

  /** 대기실에서 방장이 턴 제한시간을 바꿀 때 씀 */
  updateTurnLimit(playerId: string, sec: unknown) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('UNAUTHORIZED');
    if (!p.isHost) throw new Error('NOT_HOST');
    if (this.phase !== 'lobby') throw new Error('ALREADY_STARTED');
    this.configureTurnLimit(sec);
    this.onChange();
  }

  /** 대기실/게임 종료 화면에서 방장이 "모르는 사람 참여 허용"을 켜고 끔 */
  setPublic(playerId: string, isPublic: unknown) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('UNAUTHORIZED');
    if (!p.isHost) throw new Error('NOT_HOST');
    if (this.phase === 'playing') throw new Error('ALREADY_STARTED');
    this.isPublic = isPublic === true;
    this.onChange();
  }

  /**
   * 대기실 또는 게임이 끝난 뒤(다음 판 대기)에만 참가 가능.
   * viaMatch = 랜덤 매칭으로 들어오는 경우 - 방장이 공개를 꺼둔 방이면 거절
   */
  addPlayer(name: unknown, viaMatch = false): { playerId: string; secret: string } {
    if (viaMatch && !this.isPublic) throw new Error('NOT_PUBLIC');
    if (this.phase === 'playing') throw new Error('ALREADY_STARTED');
    if (this.players.size >= MAX_PLAYERS) throw new Error('ROOM_FULL');
    const id = crypto.randomUUID();
    const secret = crypto.randomUUID();
    const player: InternalPlayer = {
      id,
      name: (typeof name === 'string' ? name.trim().slice(0, 20) : '') || '플레이어',
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

  /** 대기실/게임 종료 화면에서 방을 나감. 방장이 나가면 다음 사람(접속 중인 사람 우선)에게 방장을 넘김 */
  removePlayer(playerId: string) {
    const p = this.players.get(playerId);
    if (!p) throw new Error('UNAUTHORIZED');
    if (this.phase === 'playing') throw new Error('ALREADY_STARTED');
    this.players.delete(playerId);
    this.turnOrder = this.turnOrder.filter((id) => id !== playerId);
    this.rttSamples.delete(playerId);
    if (p.isHost) {
      const next = this.turnOrder.map((id) => this.players.get(id)!);
      const heir = next.find((pl) => this.isPlayerConnected(pl.id)) ?? next[0];
      if (heir) heir.isHost = true;
    }
    this.reconcileHost();
    this.onChange();
  }

  auth(playerId: string, secret: string): InternalPlayer {
    const p = this.players.get(playerId);
    if (!p || p.secret !== secret) throw new Error('UNAUTHORIZED');
    return p;
  }

  /** 서버가 직접 잰 이 사람의 왕복지연(ms) 샘플을 기록 */
  recordRtt(playerId: string, rtt: number) {
    if (!this.players.has(playerId) || !Number.isFinite(rtt) || rtt < 0 || rtt > 5000) return;
    const samples = [...(this.rttSamples.get(playerId) ?? []), rtt].slice(-RTT_SAMPLES);
    this.rttSamples.set(playerId, samples);
  }

  private rttOf(playerId: string): number {
    const samples = this.rttSamples.get(playerId);
    return samples?.length ? Math.min(...samples) : 0;
  }

  /**
   * 접속 상태가 바뀔 때마다 호출. 방장이 끊겨 있으면 HOST_TRANSFER_MS 뒤에 접속 중인 다음 사람에게 넘기고,
   * 그 전에 돌아오면 취소함. 넘길 사람이 아무도 접속해 있지 않으면 그대로 두고, 누가 접속하면 다시 예약됨.
   */
  reconcileHost() {
    const host = [...this.players.values()].find((p) => p.isHost);
    if (!host || this.isPlayerConnected(host.id)) {
      if (this.hostTimer) clearTimeout(this.hostTimer);
      this.hostTimer = null;
      return;
    }
    if (this.hostTimer) return;
    this.hostTimer = setTimeout(() => {
      this.hostTimer = null;
      const current = [...this.players.values()].find((p) => p.isHost);
      if (!current || this.isPlayerConnected(current.id)) return;
      const heir = this.turnOrder.map((id) => this.players.get(id)!).find((p) => this.isPlayerConnected(p.id));
      if (!heir) return;
      current.isHost = false;
      heir.isHost = true;
      this.onChange();
    }, HOST_TRANSFER_MS);
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
   * 카드가 0장이면 종 칠 기회만 잠깐(OUT_OF_CARDS_GRACE_MS) 준 뒤 탈락.
   */
  private scheduleTurnTimer() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.phase !== 'playing' || this.pauseUntil !== null) {
      this.turnDeadline = null;
      return;
    }
    const current = this.players.get(this.turnOrder[this.currentTurnIndex])!;
    const limitMs =
      current.stack.length === 0
        ? OUT_OF_CARDS_GRACE_MS
        : this.isPlayerConnected(current.id)
          ? this.turnTimeLimitMs
          : MIN_TURN_SEC * 1000;
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
    this.turnTimer = null;
    // 종 판정 중이면 아무것도 안 함 - 판정이 끝나면 결과 표시(일시정지) 후 턴이 새로 시작됨
    if (this.graceTimer || this.phase !== 'playing' || this.pauseUntil !== null) return;
    const player = this.players.get(this.turnOrder[this.currentTurnIndex])!;
    if (player.stack.length > 0) {
      this.flip(player.id);
      return;
    }
    // 카드 0장인 채로 유예시간이 지남 - 탈락
    player.eliminated = true;
    if (!this.checkSoleSurvivorWin()) {
      this.syncTurn(1);
      this.beginTurn();
    }
    this.onChange();
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

  /** 각자 지금 내놓은(맨 위) 카드만 보고 같은 과일끼리 합산해 정확히 5인 과일을 찾음 */
  private evaluateCondition(): Fruit | null {
    const sums = new Map<Fruit, number>();
    for (const player of this.players.values()) {
      const top = player.playedPile.at(-1);
      if (!top) continue;
      sums.set(top.fruit, (sums.get(top.fruit) ?? 0) + top.count);
    }
    for (const [fruit, sum] of sums) {
      if (sum === 5) return fruit;
    }
    return null;
  }

  /** 지금 카드 상태를 시각과 함께 기록. reset이면 이전 판 기록을 버리고 새로 시작 */
  private logCondition(reset = false) {
    if (reset) this.conditionLog = [];
    this.conditionLog.push({ at: Date.now(), flipId: this.lastFlip?.resultId ?? 0, fruit: this.evaluateCondition() });
  }

  /** 서버 시각 t에 유효하던 기록의 인덱스 (t는 이번 판 시작 이후여야 함) */
  private markIndexAt(t: number): number {
    let idx = 0;
    this.conditionLog.forEach((mark, i) => {
      if (mark.at <= t) idx = i;
    });
    return idx;
  }

  /** 다음 턴을 정함. 지금 사람 다음부터 탈락하지 않은 첫 사람 */
  private syncTurn(startOffset: 0 | 1) {
    const n = this.turnOrder.length;
    for (let i = startOffset; i < startOffset + n; i++) {
      const idx = (this.currentTurnIndex + i) % n;
      if (!this.players.get(this.turnOrder[idx])!.eliminated) {
        this.currentTurnIndex = idx;
        return;
      }
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
   * 종치기는 도착 즉시 판정하지 않고 모아둠. 최초 도착 후 판정 창(기본 500ms + 가장 느린 사람의 왕복지연) 동안 모은 뒤 한꺼번에 판정.
   * - 정답 여부: 누른 순간 "그 사람 화면에 보이던 카드"(seenFlipId) 기준 - 화면이 늦게 바뀌는 사람도 보이는 대로 치면 됨
   * - 정답자끼리의 승부: 각자 화면에 5가 처음 보인 순간부터 누르기까지의 반응시간(shownAgoMs) - 인터넷이 느려서
   *   카드가 늦게 보인 사람도 반응만 빠르면 이김. 같은 기기 안에서 잰 시간 차이라 시계 오차와 무관함.
   *   단, 서버가 직접 잰 왕복지연으로 "그때쯤엔 이미 보였어야 하는 시각" 이후로는 못 늦춰서 반응시간을 부풀려 줄일 수 없음.
   */
  bell(playerId: string, correctedServerTime: unknown, seenFlipId: unknown, shownAgoMs?: unknown) {
    const player = this.players.get(playerId);
    if (!player) throw new Error('UNAUTHORIZED');
    if (player.eliminated) throw new Error('ELIMINATED');
    if (this.phase !== 'playing') throw new Error('NOT_PLAYING');
    if (this.pauseUntil !== null) throw new Error('GAME_PAUSED');
    const now = Date.now();
    player.lastActionAt = now;

    // 미래 시각은 불가능, 너무 먼 과거는 조작/동기화 실패로 보고 잘라냄
    let pressedAt =
      typeof correctedServerTime === 'number' && Number.isFinite(correctedServerTime)
        ? Math.min(now, Math.max(now - MAX_LAG_MS, correctedServerTime))
        : now;
    if (!this.conditionLog.length || pressedAt < this.conditionLog[0].at) return; // 이번 판 시작 전(결과 표시 중)에 누른 종이 늦게 도착 - 무시
    if (this.pendingBellBuffer.some((b) => b.playerId === playerId)) return; // 한 판정에 한 사람당 한 번만

    const rtt = Math.min(MAX_LAG_MS, this.rttOf(playerId));
    const serverIdx = this.markIndexAt(pressedAt);
    let idx = this.conditionLog.findIndex((m) => m.flipId === seenFlipId);
    const next = this.conditionLog[idx + 1];
    // 화면 기준을 못 믿는 경우 서버 기록으로 판정: 모르는 카드 / 누른 시각보다 나중 카드 /
    // 다음 카드가 나온 지 (왕복지연 + 여유)보다 오래 지나서 이미 화면에 보였어야 하는 경우
    if (idx === -1 || idx > serverIdx || (next && pressedAt - next.at > rtt + STALE_MARGIN_MS)) idx = serverIdx;
    const seen = this.conditionLog[idx];
    // 카드가 화면에 도착하고(단방향 지연) 사람이 반응하기(최소 반응시간)도 전에 눌렀다는 주장은 잘라냄
    pressedAt = Math.max(pressedAt, seen.at + rtt / 2 + MIN_REACTION_MS);

    const reactionMs = seen.fruit ? this.reactionTime(idx, pressedAt, now, rtt, shownAgoMs) : Infinity;
    this.pendingBellBuffer.push({ playerId, pressedAt, fruit: seen.fruit, reactionMs });
    if (!this.graceTimer) {
      this.graceTimer = setTimeout(() => this.resolveBellRound(), this.bellWindowMs());
      this.onChange(); // "판정 중" 상태를 모두에게 알림 (종소리 즉시 재생 + 카드 내기 막기)
    }
  }

  /**
   * 정답 종의 반응시간 = 그 사람 화면에 "5인 상태"가 처음 보인 순간 ~ 종을 누른 순간.
   * 5인 상태가 여러 장에 걸쳐 이어졌다면(다른 과일 카드가 나와도 계속 5) 그 구간을 처음 만든 카드부터 잼.
   * 클라이언트가 보낸 값은 다음 범위 안으로 자름 (조작 방지):
   * - 상한: 카드가 서버에 나온 뒤 누른 시각까지 (그보다 오래 걸렸다고 할 이유가 없음)
   * - 하한: 종이 서버에 실제로 도착한 시각 - 카드가 나온 시각 - 왕복지연(카드가 가고 종이 오는 시간) - 여유
   */
  private reactionTime(seenIdx: number, pressedAt: number, arrivedAt: number, rtt: number, shownAgoMs: unknown): number {
    let start = seenIdx;
    while (start > 0 && this.conditionLog[start - 1].fruit) start--;
    const mark = this.conditionLog[start];
    const sinceCard = Math.max(MIN_REACTION_MS, pressedAt - mark.at);
    const floor = Math.min(sinceCard, Math.max(MIN_REACTION_MS, arrivedAt - mark.at - rtt - SHOWN_MARGIN_MS));
    const claimed =
      shownAgoMs && typeof shownAgoMs === 'object' ? (shownAgoMs as Record<string, unknown>)[String(mark.flipId)] : undefined;
    // 화면 기록이 없으면(재접속 직후 등) 카드가 단방향 지연만큼 늦게 보였다고 추정
    const reported = typeof claimed === 'number' && Number.isFinite(claimed) ? claimed : sinceCard - rtt / 2;
    return Math.min(sinceCard, Math.max(floor, reported));
  }

  /** 판정 창 길이 - 아직 게임 중인 사람 중 가장 느린 사람의 종이 도착할 때까지 기다림 */
  private bellWindowMs(): number {
    let maxRtt = 0;
    for (const p of this.players.values()) {
      if (!p.eliminated && this.isPlayerConnected(p.id)) maxRtt = Math.max(maxRtt, this.rttOf(p.id));
    }
    return Math.min(BELL_WINDOW_MAX_MS, BELL_WINDOW_MS + maxRtt);
  }

  /** 페널티 대상의 여유 카드를 (탈락하지 않은) 다른 사람들에게 1장씩 나눠줌 */
  private giveAwayCards(penalizedId: string) {
    const penalized = this.players.get(penalizedId);
    if (!penalized) return;
    for (const otherId of this.turnOrder) {
      if (otherId === penalizedId || this.players.get(otherId)!.eliminated) continue;
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
    this.enterResultPause(); // 턴은 종 여부와 무관하게 이미 진행 중이었으므로 그대로 둠
    this.onChange();
  }

  /** 종을 정확히 맞춘 사람 - 모든 사람 앞에 쌓여있던(덮인 것 포함) 카드를 전부 걷어가고 다음 턴은 승자부터 */
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
      this.currentTurnIndex = this.turnOrder.indexOf(winnerId);
      this.enterResultPause();
    }
    this.onChange();
  }

  private resolveBellRound() {
    this.graceTimer = null;
    // 도착 순서가 아니라 보정된 "누른 시각" 순. 동시각이면 먼저 도착한 쪽
    const bells = this.pendingBellBuffer.sort((a, b) => a.pressedAt - b.pressedAt);
    this.pendingBellBuffer = [];
    if (bells.length === 0) return;

    // 정답자 중에서는 반응시간이 가장 짧은 사람이 이김 (같으면 먼저 누른 사람 - 정렬 순서 유지)
    const winner = bells.reduce<PendingBell | null>(
      (best, b) => (b.fruit && (!best || b.reactionMs < best.reactionMs) ? b : best),
      null,
    );
    if (winner) {
      // 정답자보다 먼저 잘못 친 사람만 벌칙(조용히 카드만 이동). 정답자보다 늦게 친 종은 무효
      for (const b of bells) if (!b.fruit && b.pressedAt < winner.pressedAt) this.giveAwayCards(b.playerId);
      this.finishAsWin(winner.playerId, winner.fruit!);
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
      bellPending: this.graceTimer !== null,
      isPublic: this.isPublic,
    };
  }
}
