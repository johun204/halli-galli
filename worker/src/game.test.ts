import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, MIN_PLAYERS, MAX_PLAYERS, MIN_TURN_SEC, MAX_TURN_SEC, DEFAULT_TURN_SEC } from './game';
import { buildDeck } from './deck';

test('deck has 56 cards, 4 fruits', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 56);
  assert.equal(new Set(deck.map((c) => c.fruit)).size, 4);
});

test('room lifecycle: join, start, flip, deterministic bell win', async () => {
  const room = new Room('TEST1');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);
  assert.equal(room.toPublicState(new Set()).phase, 'playing');

  const anyRoom = room as any;
  // 맨 아래에 여분 카드를 하나씩 깔아둠 - 이 테스트에선 안 뒤집을 카드라, 첫 플립 직후 0장이 되어
  // (턴이 곧바로 다음 사람에게 넘어가며) 조기 탈락 판정을 받는 걸 방지하기 위함
  anyRoom.players.get(host.playerId).stack = [{ id: 'filler-h', fruit: 'banana', count: 1 }, { id: 'a', fruit: 'lime', count: 2 }];
  anyRoom.players.get(p2.playerId).stack = [{ id: 'filler-g', fruit: 'banana', count: 1 }, { id: 'b', fruit: 'lime', count: 3 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // host가 lime 2를 냄 - 아직 guest는 안 냈으니 합 2
  let state = room.toPublicState(new Set());
  assert.equal(state.players.find((p) => p.id === host.playerId)!.playedTop?.count, 2);

  room.flip(p2.playerId); // guest가 lime 3을 냄 - 각자 맨 위 카드 합 2+3=5, 종 열림
  state = room.toPublicState(new Set());
  assert.equal(state.players.find((p) => p.id === p2.playerId)!.playedTop?.count, 3);

  await new Promise((r) => setTimeout(r, 100));
  const now = Date.now();
  room.bell(p2.playerId, now - 20); // 먼저 도착했지만 더 늦게 누름
  room.bell(host.playerId, now - 60); // 늦게 도착했지만 보정 시각상 더 먼저 누름

  await new Promise((r) => setTimeout(r, 600));

  state = room.toPublicState(new Set());
  assert.equal(state.lastBellResult?.winnerId, host.playerId, '더 이른 보정 시각이 도착 순서와 무관하게 승리해야 함');
  assert.equal(state.lastBellResult?.tookCards, 2, '덮여있던 카드까지 포함해 양쪽 낸 카드 총 2장을 가져가야 함');
  assert.deepEqual(
    [...(state.lastBellResult?.contributorIds ?? [])].sort(),
    [host.playerId, p2.playerId].sort(),
    '카드를 낸 두 사람 모두 이펙트 대상에 포함되어야 함'
  );
  // 이긴 사람이 가져간 만큼 카드 더미가 늘어야 함 (여분 카드 1장 + 획득한 2장)
  assert.equal(state.players.find((p) => p.id === host.playerId)!.cardCount, 3);
  // 승리 후엔 양쪽 다 낸 카드 자리가 비어야 함
  assert.equal(state.players.find((p) => p.id === host.playerId)!.playedTop, null);
  assert.equal(state.players.find((p) => p.id === p2.playerId)!.playedTop, null);
  room.destroy();
});

test('새 카드를 내면 이전에 낸 카드는 덮여서 계산에서 빠진다', () => {
  const room = new Room('TEST2');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.resultPauseMs = 50; // 결과 표시 정지시간을 테스트용으로 짧게
  // host: lime 5 -> lime 2 로 갱신 (더 이상 5가 아니어야 함)
  anyRoom.players.get(host.playerId).stack = [
    { id: 'a2', fruit: 'lime', count: 2 },
    { id: 'a1', fruit: 'lime', count: 5 },
  ];
  anyRoom.players.get(p2.playerId).stack = [{ id: 'b', fruit: 'banana', count: 1 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // lime 5 냄 -> 조건 충족 (열림)
  room.bell(host.playerId, Date.now()); // 즉시 본인이 맞춰서 가져감
  return new Promise((resolve) => {
    setTimeout(() => {
      const afterFirstWin = room.toPublicState(new Set());
      assert.equal(afterFirstWin.players.find((p) => p.id === host.playerId)!.playedTop, null);

      room.flip(p2.playerId); // banana 1
      room.flip(host.playerId); // lime 2로 덮어씀 - 이전 5는 이미 사라졌으므로 합 2일 뿐
      const state = room.toPublicState(new Set());
      assert.equal(state.players.find((p) => p.id === host.playerId)!.playedTop?.count, 2);
      room.destroy();
      resolve(null);
    }, 700);
  });
});

test('false ring before window opens gives 1 card to each opponent', async () => {
  const room = new Room('TEST3');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  room.start(host.playerId);
  const before = room.toPublicState(new Set()).players.find((p) => p.id === host.playerId)!.cardCount;

  room.bell(host.playerId, Date.now());
  assert.equal(room.toPublicState(new Set()).lastBellResult, null, '종은 도착 즉시가 아니라 500ms 뒤에 판정되어야 함');
  await new Promise((r) => setTimeout(r, 600));
  const state = room.toPublicState(new Set());
  assert.equal(state.lastBellResult?.penalizedIds[0], host.playerId);
  assert.equal(state.players.find((p) => p.id === host.playerId)!.cardCount, before - 1);
  room.destroy();
});

test('snapshot round-trip preserves state', () => {
  const room = new Room('TEST4');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  room.start(host.playerId);

  const restored = Room.fromSnapshot(room.toSnapshot());
  assert.equal(restored.toPublicState(new Set()).phase, 'playing');
  assert.deepEqual(
    restored.toPublicState(new Set()).players.map((p) => p.cardCount),
    room.toPublicState(new Set()).players.map((p) => p.cardCount)
  );
  room.destroy();
  restored.destroy();
});

test('턴 제한시간은 대기실에서 방장만 바꿀 수 있고, 게임 시작 후엔 못 바꾼다', () => {
  const room = new Room('TEST13');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');

  assert.throws(() => room.updateTurnLimit(p2.playerId, 20), /NOT_HOST/, '방장이 아니면 못 바꿔야 함');

  room.updateTurnLimit(host.playerId, 20);
  assert.equal(room.toPublicState(new Set()).turnTimeLimitSec, 20, '방장은 바꿀 수 있어야 함');

  room.start(host.playerId);
  assert.throws(() => room.updateTurnLimit(host.playerId, 15), /ALREADY_STARTED/, '게임 시작 후엔 못 바꿔야 함');

  room.destroy();
});

test('MIN_PLAYERS/MAX_PLAYERS constants are sane', () => {
  assert.equal(MIN_PLAYERS, 2);
  assert.equal(MAX_PLAYERS, 6);
  assert.equal(MIN_TURN_SEC, 5);
  assert.equal(MAX_TURN_SEC, 30);
  assert.equal(DEFAULT_TURN_SEC, 10);
});

test('상대가 아직 카드를 안 낸 상태에서 혼자 5를 만들면 이펙트 대상은 본인뿐이어야 함', async () => {
  const room = new Room('TEST5');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(host.playerId).stack = [{ id: 'a', fruit: 'plum', count: 5 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // 혼자 plum 5 -> 즉시 조건 충족, guest는 아직 아무것도 안 냄
  room.bell(host.playerId, Date.now());
  await new Promise((r) => setTimeout(r, 600));

  const state = room.toPublicState(new Set());
  assert.equal(state.lastBellResult?.tookCards, 1);
  assert.deepEqual(state.lastBellResult?.contributorIds, [host.playerId], '카드를 안 낸 guest는 이펙트 대상이면 안 됨');
  room.destroy();
});

test('회귀 테스트: 조건이 참인 채로 오래 지나도(재접속 등) 종을 치면 여전히 인식되어야 함', async () => {
  const room = new Room('TEST10');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(host.playerId).stack = [{ id: 'a', fruit: 'strawberry', count: 5 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // 혼자 딸기 5 -> 조건 충족
  // 예전 버그: 조건이 참이 된 지 SAFETY_MS(5초)가 지나면 서버가 조용히 포기했었음.
  // 조건 기록을 10초 전으로 밀어서 오래 지난 상황을 흉내냄 - 그 뒤로 카드 상태가 안 바뀌었으면 여전히 유효해야 함.
  for (const mark of anyRoom.conditionLog) mark.at -= 10_000;

  room.bell(host.playerId, Date.now());
  await new Promise((r) => setTimeout(r, 600));

  const state = room.toPublicState(new Set());
  assert.equal(state.lastBellResult?.winnerId, host.playerId, '오래 지나도 실제 카드 상태가 5를 만족하면 종치기가 인식되어야 함');
  room.destroy();
});

test('턴 제한시간이 지나면 서버가 대신 카드를 뒤집어 게임이 멈추지 않는다', async () => {
  const room = new Room('TEST6');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  (room as any).turnTimeLimitMs = 60; // 실제 5~30초 대신 테스트용으로 짧게 (start() 전에 설정해야 반영됨)
  room.start(host.playerId);

  const before = room.toPublicState(new Set());
  const firstTurn = before.currentTurnPlayerId;
  assert.ok(firstTurn === host.playerId || firstTurn === p2.playerId);

  await new Promise((r) => setTimeout(r, 200));

  const after = room.toPublicState(new Set());
  assert.notEqual(after.currentTurnPlayerId, firstTurn, '제한시간 초과 시 자동으로 다음 사람 턴으로 넘어가야 함');
  assert.equal(after.players.reduce((s, p) => s + p.cardCount, 0) + after.players.reduce((s, p) => s + p.playedCount, 0), 56);
  room.destroy();
});

test('카드가 0장인 채로 자기 차례가 오면 탈락하고, 한 명만 남으면 그 사람 승리', () => {
  const room = new Room('TEST7');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(host.playerId).stack = [{ id: 'h1', fruit: 'banana', count: 1 }];
  anyRoom.players.get(p2.playerId).stack = [{ id: 'g1', fruit: 'plum', count: 1 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // banana 1 - 매치 안 됨, 카드 0장 남음
  room.flip(p2.playerId); // plum 1 - 매치 안 됨. 턴이 다시 host로 오는데 host는 카드가 0장 -> 탈락

  const state = room.toPublicState(new Set());
  assert.equal(state.phase, 'ended');
  assert.equal(state.winnerId, p2.playerId, '탈락자를 빼고 한 명만 남으면 즉시 승리');
  assert.equal(state.players.find((p) => p.id === host.playerId)!.eliminated, true);
  assert.equal(
    state.players.find((p) => p.id === host.playerId)!.playedTop?.fruit,
    'banana',
    '탈락해도 이미 낸 카드는 그대로 남아있어야 함(합산에 계속 사용됨)'
  );
  room.destroy();
});

test('종을 맞추면 결과를 보여주며 잠깐 멈췄다가 턴 타이머를 새로 시작한다', async () => {
  const room = new Room('TEST8');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  const anyRoom = room as any;
  anyRoom.resultPauseMs = 300;
  anyRoom.turnTimeLimitMs = 5000;
  room.start(host.playerId);

  anyRoom.players.get(host.playerId).stack = [{ id: 'a', fruit: 'lime', count: 5 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // 혼자 5 -> 종 열림
  room.bell(host.playerId, Date.now());
  await new Promise((r) => setTimeout(r, 650)); // BELL_WINDOW_MS(500) 지나 판정은 됐지만 pause(300ms)는 아직 안 끝남

  let state = room.toPublicState(new Set());
  assert.equal(state.paused, true, '결과를 보여주는 동안은 일시정지 상태여야 함');
  assert.equal(state.lastBellResult?.fruit, 'lime', '무슨 과일로 맞췄는지 표시되어야 함');
  assert.throws(() => room.flip(p2.playerId), /GAME_PAUSED/, '멈춰있는 동안엔 카드를 낼 수 없어야 함');

  await new Promise((r) => setTimeout(r, 300)); // pause 종료 대기
  state = room.toPublicState(new Set());
  assert.equal(state.paused, false, '일시정지가 끝나야 함');
  assert.ok(state.turnDeadline !== null, '재개 후 턴 타이머가 새로 시작되어야 함');
  room.destroy();
});

test('접속이 끊긴 사람 차례면 최소시간만, 재접속하면 원래 시간으로 리셋된다', async () => {
  const room = new Room('TEST11');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  const anyRoom = room as any;
  anyRoom.turnTimeLimitMs = 20_000; // 넉넉한 기본 제한시간
  let hostConnected = true;
  room.isPlayerConnected = (id) => (id === host.playerId ? hostConnected : true);
  room.start(host.playerId); // 셔플되므로 host가 항상 첫 턴은 아니지만, 아래에서 host 차례로 맞춰줌
  anyRoom.currentTurnIndex = anyRoom.turnOrder.indexOf(host.playerId);
  anyRoom.turnDeadline = null;
  (room as any).scheduleTurnTimer(); // host 차례로 다시 스케줄

  let state = room.toPublicState(new Set());
  const fullRemaining = state.turnDeadline! - Date.now();
  assert.ok(fullRemaining > 15_000, '접속 중일 땐 원래 제한시간을 받아야 함');

  hostConnected = false;
  room.reconcileTurnTimerFor(host.playerId); // 끊김 감지
  state = room.toPublicState(new Set());
  const shortRemaining = state.turnDeadline! - Date.now();
  assert.ok(shortRemaining <= MIN_TURN_SEC * 1000 && shortRemaining > 0, '끊기면 최소시간으로 줄어야 함');

  hostConnected = true;
  room.reconcileTurnTimerFor(host.playerId); // 재접속
  state = room.toPublicState(new Set());
  const restoredRemaining = state.turnDeadline! - Date.now();
  assert.ok(restoredRemaining > 15_000, '재접속하면 원래 제한시간으로 복구되어야 함');

  room.destroy();
});

test('턴 타이머 복구는 한 턴에 한 번만 - 계속 새로고침해도 두 번째부턴 리셋 안 됨', () => {
  const room = new Room('TEST12');
  const host = room.addPlayer('host');
  room.addPlayer('guest');
  const anyRoom = room as any;
  anyRoom.turnTimeLimitMs = 20_000;
  let hostConnected = true;
  room.isPlayerConnected = (id) => (id === host.playerId ? hostConnected : true);
  room.start(host.playerId);
  anyRoom.currentTurnIndex = anyRoom.turnOrder.indexOf(host.playerId);
  anyRoom.turnDeadline = null;
  anyRoom.scheduleTurnTimer();

  // 1번째 새로고침: 끊김 -> 최소시간, 재접속 -> 원래 시간으로 복구(정상)
  hostConnected = false;
  room.reconcileTurnTimerFor(host.playerId);
  hostConnected = true;
  room.reconcileTurnTimerFor(host.playerId);
  let state = room.toPublicState(new Set());
  assert.ok(state.turnDeadline! - Date.now() > 15_000, '이번 턴 첫 재접속은 원래 시간으로 복구되어야 함');

  // 2번째 새로고침(같은 턴 안에서): 끊김 -> 최소시간까지는 되지만, 재접속해도 더는 복구되면 안 됨
  hostConnected = false;
  room.reconcileTurnTimerFor(host.playerId);
  const afterSecondDisconnect = room.toPublicState(new Set()).turnDeadline!;
  hostConnected = true;
  room.reconcileTurnTimerFor(host.playerId);
  state = room.toPublicState(new Set());
  assert.equal(
    state.turnDeadline,
    afterSecondDisconnect,
    '같은 턴에서 두 번째 재접속은 카운트다운을 다시 늘려주면 안 됨 (악용 방지)'
  );

  room.destroy();
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

  room.start(host.playerId); // 방장이 다시 시작
  const state = room.toPublicState(new Set());
  assert.equal(state.phase, 'playing');
  assert.equal(state.winnerId, null);
  assert.ok(state.players.every((p) => !p.eliminated), '재시작하면 탈락 상태가 풀려야 함');
  assert.equal(state.players.reduce((s, p) => s + p.cardCount, 0), 56, '카드가 다시 전부 분배되어야 함');
  room.destroy();
});

test('지연 보정: 누른 순간엔 5였는데 종이 도착하기 전에 다른 카드가 나와 깨졌어도 정답 처리', async () => {
  const room = new Room('TEST14');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(host.playerId).stack = [{ id: 'fh', fruit: 'banana', count: 1 }, { id: 'a', fruit: 'lime', count: 5 }];
  anyRoom.players.get(p2.playerId).stack = [{ id: 'fg', fruit: 'banana', count: 1 }, { id: 'b', fruit: 'lime', count: 1 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId); // lime 5 -> 조건 충족
  await new Promise((r) => setTimeout(r, 60));
  const pressedAt = Date.now() - 30; // 느린 네트워크의 host가 이 시점에 누름
  room.flip(p2.playerId); // lime 1 -> 합 6, 조건 깨짐 (host의 종보다 서버에 먼저 도착)
  room.bell(host.playerId, pressedAt);
  await new Promise((r) => setTimeout(r, 600));

  const state = room.toPublicState(new Set());
  assert.equal(state.lastBellResult?.winnerId, host.playerId, '누른 순간의 카드 상태로 판정해야 함');
  assert.equal(state.lastBellResult?.fruit, 'lime');
  room.destroy();
});

test('지연 보정: 1초보다 더 과거라고 주장하는 종은 잘라내서 이득을 못 본다', async () => {
  const room = new Room('TEST15');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  room.start(host.playerId);

  const anyRoom = room as any;
  anyRoom.players.get(host.playerId).stack = [{ id: 'a', fruit: 'plum', count: 5 }];
  anyRoom.turnOrder = [host.playerId, p2.playerId];
  anyRoom.currentTurnIndex = 0;

  room.flip(host.playerId);
  room.bell(host.playerId, Date.now());
  room.bell(p2.playerId, 0); // 조작된 시각 -> 1초 전으로 잘리고, 그건 이번 판 시작 전이라 무시됨
  await new Promise((r) => setTimeout(r, 600));

  assert.equal(room.toPublicState(new Set()).lastBellResult?.winnerId, host.playerId);
  room.destroy();
});

test('누른 시각 순으로 정답자보다 먼저 잘못 친 사람만 벌칙, 늦게 친 사람은 무효', async () => {
  const room = new Room('TEST16');
  const host = room.addPlayer('host');
  const p2 = room.addPlayer('guest');
  const p3 = room.addPlayer('third');
  room.start(host.playerId);

  const anyRoom = room as any;
  const filler = (id: string) => Array.from({ length: 3 }, (_, i) => ({ id: `${id}${i}`, fruit: 'banana', count: 1 }));
  anyRoom.players.get(host.playerId).stack = [...filler('h'), { id: 'a', fruit: 'strawberry', count: 5 }];
  anyRoom.players.get(p2.playerId).stack = filler('g');
  anyRoom.players.get(p3.playerId).stack = filler('t');
  anyRoom.turnOrder = [host.playerId, p2.playerId, p3.playerId];
  anyRoom.currentTurnIndex = 0;

  const beforeFlip = Date.now();
  await new Promise((r) => setTimeout(r, 30));
  room.flip(host.playerId); // 딸기 5
  await new Promise((r) => setTimeout(r, 40));
  room.bell(p3.playerId, Date.now()); // 정답자보다 늦게 누름 -> 무효
  room.bell(host.playerId, Date.now() - 10); // 정답
  room.bell(p2.playerId, beforeFlip + 5); // 카드가 나오기 전에 누름 -> 벌칙
  await new Promise((r) => setTimeout(r, 600));

  const state = room.toPublicState(new Set());
  const count = (id: string) => state.players.find((p) => p.id === id)!.cardCount;
  assert.equal(state.lastBellResult?.winnerId, host.playerId);
  assert.equal(count(p2.playerId), 1, 'p2는 2명에게 1장씩 줘야 함');
  assert.equal(count(p3.playerId), 4, 'p3는 벌칙 없이 p2에게 1장만 받아야 함');
  room.destroy();
});
