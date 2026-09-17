import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, MIN_PLAYERS, MAX_PLAYERS, MIN_TURN_SEC, MAX_TURN_SEC, DEFAULT_TURN_SEC } from './game';
import { buildDeck } from './deck';
import type { Card, Fruit } from '../../shared/types';

// 실제 시간을 기다리지 않도록 setTimeout과 Date를 가짜 시계로 바꿔서 tick()으로 시간을 흘려보냄
beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
afterEach(() => mock.timers.reset());
const tick = (ms: number) => mock.timers.tick(ms);

let cardSeq = 0;
const card = (fruit: Fruit, count: number): Card => ({ id: `t${cardSeq++}`, fruit, count });
const filler = (n: number) => Array.from({ length: n }, () => card('banana', 1));

/** 방을 만들고 시작한 뒤 각자 카드 더미(마지막 원소가 맨 위)와 앉은 순서를 원하는 대로 맞춤 */
function setup(stacks: Card[][]) {
  const room = new Room('TEST');
  const ids = stacks.map((_, i) => room.addPlayer(`p${i}`).playerId);
  room.start(ids[0]);
  const anyRoom = room as any;
  stacks.forEach((stack, i) => (anyRoom.players.get(ids[i]).stack = stack));
  anyRoom.turnOrder = [...ids];
  anyRoom.currentTurnIndex = 0;
  const state = () => room.toPublicState(new Set());
  const player = (id: string) => state().players.find((p) => p.id === id)!;
  const flipId = () => state().lastFlip?.resultId ?? 0;
  return { room, ids, anyRoom, state, player, flipId };
}

test('덱은 56장, 과일 4종, 과일마다 공식 구성(1개 5장/2개 3장/3개 3장/4개 2장/5개 1장)', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 56);
  assert.equal(new Set(deck.map((c) => c.fruit)).size, 4);
  const strawberry = deck.filter((c) => c.fruit === 'strawberry');
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => strawberry.filter((c) => c.count === n).length), [5, 3, 3, 2, 1]);
});

test('도착 순서와 무관하게 더 먼저 누른 사람이 이기고, 다음 턴은 승자부터', () => {
  const { room, ids, state, player, flipId } = setup([
    [...filler(1), card('lime', 2)],
    [...filler(1), card('lime', 3)],
  ]);
  const [host, guest] = ids;

  room.flip(host); // lime 2
  room.flip(guest); // lime 3 -> 합 5, 이제 차례는 host
  tick(300);
  const now = Date.now();
  room.bell(guest, now - 20, flipId()); // 먼저 도착했지만 더 늦게 누름
  room.bell(host, now - 60, flipId()); // 늦게 도착했지만 보정 시각상 더 먼저 누름
  assert.equal(state().bellPending, true, '판정 중임을 모두에게 알려야 함');
  tick(500);

  const s = state();
  assert.equal(s.bellPending, false);
  assert.equal(s.lastBellResult?.winnerId, host, '더 이른 보정 시각이 도착 순서와 무관하게 승리해야 함');
  assert.equal(s.lastBellResult?.tookCards, 2);
  assert.deepEqual([...(s.lastBellResult?.contributorIds ?? [])].sort(), [host, guest].sort());
  assert.equal(player(host).cardCount, 3);
  assert.equal(player(host).playedTop, null);
  assert.equal(player(guest).playedTop, null);

  // 승자가 guest인 경우에도 다음 턴이 승자에게 가는지 보기 위해 순서를 바꿔서 한 번 더 확인
  const again = setup([
    [...filler(2), card('plum', 5)],
    [...filler(2)],
  ]);
  again.room.flip(again.ids[0]); // host가 plum 5, 차례는 guest
  again.room.flip(again.ids[1]); // guest가 banana 1, 차례는 다시 host
  tick(300);
  again.room.bell(again.ids[1], Date.now(), again.flipId());
  tick(500);
  assert.equal(again.state().lastBellResult?.winnerId, again.ids[1]);
  assert.equal(again.state().currentTurnPlayerId, again.ids[1], '종을 맞춘 사람이 다음 턴을 시작해야 함');
});

test('새 카드를 내면 이전에 낸 카드는 덮여서 계산에서 빠진다', () => {
  const { room, ids, state, player, flipId } = setup([
    [card('lime', 2), card('lime', 5)],
    [card('banana', 1)],
  ]);
  const [host, guest] = ids;

  room.flip(host); // lime 5
  tick(200);
  room.bell(host, Date.now(), flipId());
  tick(500); // 판정
  tick(3000); // 결과 표시 (타이머 안에서 새로 건 타이머는 tick을 나눠야 실행됨)
  assert.equal(player(host).playedTop, null);
  assert.equal(state().currentTurnPlayerId, host, '승자부터 다시 시작');

  room.flip(host); // lime 2
  room.flip(guest); // banana 1
  assert.equal(player(host).playedTop?.count, 2);
  tick(200);
  room.bell(guest, Date.now(), flipId());
  tick(500);
  assert.equal(state().lastBellResult?.penalizedIds[0], guest, '덮인 lime 5는 계산에 안 들어가므로 오답');
});

test('합이 5가 아닐 때 치면 500ms 뒤에 벌칙으로 상대에게 1장씩 준다', () => {
  const { room, ids, state, player, flipId } = setup([filler(3), filler(3)]);
  const [host, guest] = ids;
  tick(200);
  room.bell(host, Date.now(), flipId());
  assert.equal(state().lastBellResult, null, '종은 도착 즉시가 아니라 500ms 뒤에 판정되어야 함');
  tick(500);
  assert.equal(state().lastBellResult?.penalizedIds[0], host);
  assert.equal(player(host).cardCount, 2);
  assert.equal(player(guest).cardCount, 4);
});

test('벌칙 카드는 이미 탈락한 사람에게는 가지 않는다', () => {
  const { room, ids, anyRoom, player, flipId } = setup([filler(3), filler(3), []]);
  const [host, guest, out] = ids;
  anyRoom.players.get(out).eliminated = true;
  tick(200);
  room.bell(host, Date.now(), flipId());
  tick(500);
  assert.equal(player(out).cardCount, 0, '탈락자에게 카드가 가면 그 카드는 영영 못 씀');
  assert.equal(player(guest).cardCount, 4);
  assert.equal(player(host).cardCount, 2);
});

test('snapshot round-trip preserves state', () => {
  const { room } = setup([filler(3), filler(3)]);
  const restored = Room.fromSnapshot(room.toSnapshot());
  assert.equal(restored.toPublicState(new Set()).phase, 'playing');
  assert.deepEqual(
    restored.toPublicState(new Set()).players.map((p) => p.cardCount),
    room.toPublicState(new Set()).players.map((p) => p.cardCount),
  );
});

test('턴 제한시간은 대기실에서 방장만 바꿀 수 있고, 숫자가 아니면 무시, 게임 시작 후엔 못 바꾼다', () => {
  const room = new Room('TEST13');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');

  assert.throws(() => room.updateTurnLimit(p2.playerId, 20), /NOT_HOST/);
  room.updateTurnLimit(host.playerId, 20);
  assert.equal(room.toPublicState(new Set()).turnTimeLimitSec, 20);
  room.updateTurnLimit(host.playerId, 'abc');
  assert.equal(room.toPublicState(new Set()).turnTimeLimitSec, 20, '잘못된 값으로 제한시간이 NaN이 되면 안 됨');

  room.start(host.playerId);
  assert.throws(() => room.updateTurnLimit(host.playerId, 15), /ALREADY_STARTED/);
});

test('닉네임이 문자열이 아니거나 비어 있으면 기본 이름을 쓴다', () => {
  const room = new Room('TEST');
  room.addPlayer(123);
  room.addPlayer('   ');
  assert.deepEqual(
    room.toPublicState(new Set()).players.map((p) => p.name),
    ['플레이어', '플레이어'],
  );
});

test('MIN_PLAYERS/MAX_PLAYERS constants are sane', () => {
  assert.equal(MIN_PLAYERS, 2);
  assert.equal(MAX_PLAYERS, 6);
  assert.equal(MIN_TURN_SEC, 5);
  assert.equal(MAX_TURN_SEC, 30);
  assert.equal(DEFAULT_TURN_SEC, 10);
});

test('상대가 아직 카드를 안 낸 상태에서 혼자 5를 만들면 이펙트 대상은 본인뿐이어야 함', () => {
  const { room, ids, state, flipId } = setup([[...filler(1), card('plum', 5)], filler(2)]);
  room.flip(ids[0]);
  tick(200);
  room.bell(ids[0], Date.now(), flipId());
  tick(500);
  assert.equal(state().lastBellResult?.tookCards, 1);
  assert.deepEqual(state().lastBellResult?.contributorIds, [ids[0]]);
});

test('회귀 테스트: 조건이 참인 채로 오래 지나도 종을 치면 여전히 인식되어야 함', () => {
  const { room, ids, state, flipId } = setup([[...filler(1), card('strawberry', 5)], filler(2)]);
  room.flip(ids[0]);
  tick(9000); // 턴 제한(10초) 직전까지 아무도 안 침
  room.bell(ids[1], Date.now(), flipId());
  tick(500);
  assert.equal(state().lastBellResult?.winnerId, ids[1]);
});

test('턴 제한시간이 지나면 서버가 대신 카드를 뒤집어 게임이 멈추지 않는다', () => {
  const room = new Room('TEST6');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  room.start(host.playerId);

  const firstTurn = room.toPublicState(new Set()).currentTurnPlayerId;
  tick(DEFAULT_TURN_SEC * 1000);
  const after = room.toPublicState(new Set());
  assert.notEqual(after.currentTurnPlayerId, firstTurn);
  assert.equal(after.players.reduce((s, p) => s + p.cardCount + p.playedCount, 0), 56);
});

test('카드가 0장인 사람에게 차례가 와도 바로 탈락하지 않고, 그 사이 종을 쳐서 카드를 되찾을 수 있다', () => {
  const { room, ids, state, player, flipId } = setup([[...filler(2), card('lime', 5)], []]);
  const [host, guest] = ids;

  room.flip(host); // lime 5 -> 차례는 카드 0장인 guest
  assert.equal(state().phase, 'playing', '예전 버그: 여기서 guest가 즉시 탈락하고 host가 바로 이겼음');
  assert.equal(player(guest).eliminated, false);
  tick(300);
  room.bell(guest, Date.now(), flipId());
  tick(500);
  assert.equal(state().lastBellResult?.winnerId, guest);
  assert.equal(player(guest).cardCount, 1);
});

test('카드 0장인 채로 유예시간(2초)이 지나면 탈락하고, 한 명만 남으면 그 사람 승리', () => {
  const { room, ids, state, player } = setup([[card('banana', 1)], [card('plum', 1)]]);
  const [host, guest] = ids;

  room.flip(host); // banana 1 - host 0장
  room.flip(guest); // plum 1 - 차례는 0장인 host
  assert.equal(state().phase, 'playing');
  tick(2000);

  assert.equal(state().phase, 'ended');
  assert.equal(state().winnerId, guest);
  assert.equal(player(host).eliminated, true);
  assert.equal(player(host).playedTop?.fruit, 'banana', '탈락해도 이미 낸 카드는 그대로 남아있어야 함');
});

test('종을 맞추면 결과를 보여주며 잠깐 멈췄다가 턴 타이머를 새로 시작한다', () => {
  const { room, ids, state, flipId } = setup([[...filler(1), card('lime', 5)], filler(2)]);
  room.flip(ids[0]);
  tick(200);
  room.bell(ids[0], Date.now(), flipId());
  assert.throws(() => room.flip(ids[1]), /BELL_WINDOW_OPEN/, '판정 중엔 카드를 낼 수 없어야 함');
  tick(500);

  let s = state();
  assert.equal(s.paused, true);
  assert.equal(s.lastBellResult?.fruit, 'lime');
  assert.throws(() => room.flip(ids[1]), /GAME_PAUSED/);

  tick(3000);
  s = state();
  assert.equal(s.paused, false);
  assert.ok(s.turnDeadline !== null);
});

test('결과 표시 중에 누른 종이 늦게 도착하면 새 판에서 무시된다', () => {
  const { room, ids, state, flipId } = setup([[...filler(3), card('lime', 5)], filler(3)]);
  room.flip(ids[0]);
  tick(200);
  room.bell(ids[0], Date.now(), flipId());
  tick(500);
  const pressedDuringPause = Date.now() + 2900;
  tick(3000); // 결과 표시 끝
  tick(50);
  room.bell(ids[1], pressedDuringPause, flipId());
  assert.equal(state().bellPending, false);
});

test('지연 보정: 내 화면에 5가 보일 때 쳤다면, 서버에서 이미 다른 카드로 깨졌어도 정답 (지연이 큰 사람만 인정)', () => {
  const run = (rtt: number) => {
    const t = setup([[...filler(2), card('lime', 5)], [...filler(2), card('lime', 1)]]);
    const [host, guest] = t.ids;
    t.room.recordRtt(host, rtt);
    t.room.flip(host); // lime 5
    const seen = t.flipId();
    tick(150);
    t.room.flip(guest); // lime 1 -> 서버에서는 합 6으로 깨짐
    tick(150);
    t.room.bell(host, Date.now(), seen); // host 화면은 아직 lime 5 상태
    tick(500);
    return t.state().lastBellResult;
  };
  assert.equal(run(250)?.winnerId !== null, true, '왕복 250ms면 150ms 전에 바뀐 카드는 아직 못 봤을 수 있음 -> 정답');
  assert.equal(run(10)?.winnerId, null, '지연이 거의 없는데 옛 화면이라고 주장하면 서버 상태로 판정 -> 오답');
});

test('지연 보정: 1초보다 더 과거라고 주장하는 종은 잘라내서 이득을 못 본다', () => {
  const { room, ids, state, flipId } = setup([[...filler(1), card('plum', 5)], filler(2)]);
  room.flip(ids[0]);
  tick(200);
  room.bell(ids[0], Date.now(), flipId());
  room.bell(ids[1], 0, flipId()); // 조작된 시각 -> 1초 전으로 잘리고, 그건 이번 판 시작 전이라 무시됨
  tick(500);
  assert.equal(state().lastBellResult?.winnerId, ids[0]);
});

test('조작 방지: 카드가 나오자마자 눌렀다고 주장해도 (단방향 지연 + 최소 반응시간) 이전으로는 인정 안 됨', () => {
  const { room, ids, state, flipId } = setup([[...filler(1), card('plum', 5)], filler(2)]);
  const [cheater, honest] = ids;
  room.recordRtt(cheater, 100);
  room.flip(cheater);
  const flippedAt = Date.now();
  tick(300);
  room.bell(cheater, flippedAt + 1, flipId()); // 1ms 만에 눌렀다고 주장 -> flippedAt + 50 + 80 으로 잘림
  room.bell(honest, flippedAt + 120, flipId());
  tick(500);
  assert.equal(state().lastBellResult?.winnerId, honest);
});

test('누른 시각 순으로 정답자보다 먼저 잘못 친 사람만 벌칙, 늦게 친 사람은 무효', () => {
  const { room, ids, state, player, flipId } = setup([
    [...filler(3), card('strawberry', 5)],
    filler(3),
    filler(3),
  ]);
  const [host, p2, p3] = ids;

  tick(200);
  const beforeFlip = Date.now();
  tick(30);
  room.flip(host); // 딸기 5
  tick(200);
  room.bell(p3, Date.now(), flipId()); // 정답자보다 늦게 누름 -> 무효
  room.bell(host, Date.now() - 60, flipId()); // 정답
  room.bell(p2, beforeFlip + 5, 0); // 카드가 나오기 전에 누름 -> 벌칙
  tick(500);

  assert.equal(state().lastBellResult?.winnerId, host);
  assert.equal(player(p2).cardCount, 1, 'p2는 2명에게 1장씩 줘야 함');
  assert.equal(player(p3).cardCount, 4, 'p3는 벌칙 없이 p2에게 1장만 받아야 함');
});

test('접속이 끊긴 사람 차례면 최소시간만, 재접속하면 원래 시간으로 리셋된다 (한 턴에 한 번만)', () => {
  const room = new Room('TEST11');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  const anyRoom = room as any;
  anyRoom.turnTimeLimitMs = 20_000;
  let hostConnected = true;
  room.isPlayerConnected = (id) => (id === host.playerId ? hostConnected : true);
  room.start(host.playerId);
  anyRoom.currentTurnIndex = anyRoom.turnOrder.indexOf(host.playerId);
  anyRoom.scheduleTurnTimer();
  const remaining = () => room.toPublicState(new Set()).turnDeadline! - Date.now();

  assert.ok(remaining() > 15_000);
  hostConnected = false;
  room.reconcileTurnTimerFor(host.playerId);
  assert.ok(remaining() <= MIN_TURN_SEC * 1000 && remaining() > 0);
  hostConnected = true;
  room.reconcileTurnTimerFor(host.playerId);
  assert.ok(remaining() > 15_000, '첫 재접속은 원래 시간으로 복구');

  hostConnected = false;
  room.reconcileTurnTimerFor(host.playerId);
  const afterSecondDisconnect = room.toPublicState(new Set()).turnDeadline;
  hostConnected = true;
  room.reconcileTurnTimerFor(host.playerId);
  assert.equal(room.toPublicState(new Set()).turnDeadline, afterSecondDisconnect, '같은 턴 두 번째 재접속은 복구 안 됨');
});

test('방장이 10초 넘게 끊기면 접속 중인 다음 사람에게 방장이 넘어가고, 그 전에 돌아오면 유지된다', () => {
  const room = new Room('TEST');
  const host = room.addPlayer('host').playerId;
  const guest = room.addPlayer('guest').playerId;
  const connected = new Set([host, guest]);
  room.isPlayerConnected = (id) => connected.has(id);
  const hostId = () => room.toPublicState(new Set()).players.find((p) => p.isHost)?.id;

  connected.delete(host);
  room.reconcileHost();
  tick(5000);
  connected.add(host);
  room.reconcileHost();
  tick(10_000);
  assert.equal(hostId(), host, '10초 안에 돌아오면 방장 유지');

  connected.delete(host);
  room.reconcileHost();
  tick(10_000);
  assert.equal(hostId(), guest, '10초 넘게 끊기면 접속 중인 사람에게 이양');
});

test('대기실/게임 종료 후엔 나갈 수 있고(방장이면 이양), 게임 중엔 못 나감. 게임 종료 후엔 새로 참가 가능', () => {
  const room = new Room('TEST');
  const host = room.addPlayer('host').playerId;
  const guest = room.addPlayer('guest').playerId;
  const third = room.addPlayer('third').playerId;

  room.removePlayer(host);
  let s = room.toPublicState(new Set());
  assert.deepEqual(s.players.map((p) => p.id), [guest, third]);
  assert.equal(s.players.find((p) => p.isHost)?.id, guest);

  room.start(guest);
  assert.throws(() => room.removePlayer(third), /ALREADY_STARTED/);
  assert.throws(() => room.addPlayer('late'), /ALREADY_STARTED/);

  (room as any).phase = 'ended';
  room.addPlayer('next-round');
  room.removePlayer(third);
  s = room.toPublicState(new Set());
  assert.equal(s.players.length, 2);
});

test('게임 종료 후 다시 시작하면 탈락 상태와 카드가 초기화된다', () => {
  const room = new Room('TEST9');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(p2.playerId).eliminated = true;
  anyRoom.phase = 'ended';
  anyRoom.winnerId = host.playerId;

  room.start(host.playerId);
  const state = room.toPublicState(new Set());
  assert.equal(state.phase, 'playing');
  assert.equal(state.winnerId, null);
  assert.ok(state.players.every((p) => !p.eliminated));
  assert.equal(state.players.reduce((s, p) => s + p.cardCount, 0), 56);
});
