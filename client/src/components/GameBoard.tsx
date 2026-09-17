import { useEffect, useRef, useState } from 'react';
import { correctedNow, type Identity } from '../api';
import { useRoom } from '../hooks/useRoom';
import { playBellSound } from '../sound';
import { MAX_PLAYERS, MAX_TURN_SEC, MIN_TURN_SEC, REACTIONS } from '../../../shared/types';
import type { Fruit, PublicPlayer, ReactionEmoji, RoomPublicState } from '../../../shared/types';
import { CardStack } from './CardStack';
import { QrCode } from './QrCode';
import { Table } from './Table';

/** 서버가 보내준 턴 마감 시각을 기준으로 로컬에서 매초 카운트다운 표시 */
function useCountdown(deadline: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - correctedNow()) / 1000)));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return remaining;
}

// BELL_WINDOW_OPEN / GAME_PAUSED / ELIMINATED는 일부러 문구를 안 보여줌
const ERROR_KO: Record<string, string> = {
  NOT_YOUR_TURN: '아직 내 차례가 아니에요',
  NO_CARDS: '남은 카드가 없어요',
  NOT_PLAYING: '게임이 진행 중이 아니에요',
  ROOM_FULL: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)`,
  NOT_ENOUGH_PLAYERS: '최소 2명이 있어야 시작할 수 있어요',
  NOT_HOST: '방장만 시작할 수 있어요',
  ROOM_NOT_FOUND: '존재하지 않는 방이에요',
};

const FRUIT_KO: Record<Fruit, string> = {
  strawberry: '딸기',
  banana: '바나나',
  lime: '사과', // 내부 id는 기존 저장 데이터 호환 때문에 유지, 화면 표시는 이모지(🍏)에 맞춤
  plum: '포도', // 이모지 🍇
};

// 내가 친 종은 누르는 즉시 소리를 내므로, 서버의 "판정 중" 알림이 이 시간 안에 오면 소리를 또 내지 않음
const LOCAL_RING_DEDUPE_MS = 1000;

let localEventId = 0;

export function GameBoard({
  code,
  identity,
  onUnreachable,
  onLeave,
}: {
  code: string;
  identity: Identity;
  onUnreachable: () => void;
  onLeave: () => void;
}) {
  const { room, error, connected, unreachable, lastEmoji, me, start, flip, ringBell, sendEmoji, setTurnLimit, leave } =
    useRoom(code, identity);
  // Hooks는 항상 같은 순서로 호출되어야 하므로, 아래의 phase별 조건부 return보다 먼저 호출한다.
  const remaining = useCountdown(room?.turnDeadline ?? null);
  const [myReaction, setMyReaction] = useState<{ id: number; emoji: ReactionEmoji } | null>(null);
  const [pendingFlip, setPendingFlip] = useState(false);
  const lastLocalRingAt = useRef(0);

  // 누군가 종을 치면(판정 대기 시작) 모두에게 바로 종소리 - 실제 게임처럼 결과를 기다리지 않음
  useEffect(() => {
    if (room?.bellPending && Date.now() - lastLocalRingAt.current > LOCAL_RING_DEDUPE_MS) playBellSound();
  }, [room?.bellPending]);

  // 서버가 내 플립을 실제로 처리했다는 확인(lastFlip)이 오면 "뒤집는 중" 표시를 내림
  useEffect(() => {
    if (room?.lastFlip?.playerId === me) setPendingFlip(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.lastFlip?.resultId]);

  // 응답이 안 와도 언젠간 풀리도록 하는 안전장치 - 다음 플립을 하면 이전 타이머는 취소됨
  useEffect(() => {
    if (!pendingFlip) return;
    const t = setTimeout(() => setPendingFlip(false), 900);
    return () => clearTimeout(t);
  }, [pendingFlip]);

  // 방이 없어졌거나(오래 끊겨서 정리됨) 같은 코드로 완전히 다른 방이 생긴 경우 - 더 기다려도 소용없으니 홈으로
  useEffect(() => {
    if (unreachable) onUnreachable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreachable]);

  function handleLeave() {
    leave();
    onLeave();
  }

  if (unreachable) return <div className="loading">연결 중…</div>;
  if (!room) return <div className="loading">연결 중…</div>;
  if (room.phase === 'lobby')
    return (
      <WaitingRoom
        room={room}
        me={me}
        code={code}
        onStart={start}
        onSetTurnLimit={setTurnLimit}
        onLeave={handleLeave}
        error={error}
      />
    );
  if (room.phase === 'ended')
    return <EndedScreen room={room} me={me} code={code} onRestart={start} onLeave={handleLeave} error={error} />;

  const myPlayer = room.players.find((p) => p.id === me)!;
  const isMyTurn = room.currentTurnPlayerId === me;
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '';

  function handleFlip() {
    setPendingFlip(true);
    flip();
  }

  function handleRing() {
    if (!room!.paused && !myPlayer.eliminated) {
      lastLocalRingAt.current = Date.now();
      playBellSound();
    }
    ringBell();
  }

  function handleEmojiPick(emoji: ReactionEmoji) {
    setMyReaction({ id: ++localEventId, emoji });
    sendEmoji(emoji);
  }

  return (
    <div className="board">
      {!connected && <div className="toast-error toast-reconnect">연결이 끊겼어요, 다시 연결하는 중…</div>}

      <Table
        players={room.players}
        me={me}
        currentTurnPlayerId={room.currentTurnPlayerId}
        turnRemainingSec={remaining}
        lastBellResult={room.lastBellResult}
        lastEmoji={lastEmoji}
        myReaction={myReaction}
        myPendingFlip={pendingFlip}
        bellPending={room.bellPending}
        serverNow={room.serverTime}
        onRing={handleRing}
      />

      {room.paused && room.lastBellResult && <PauseOverlay result={room.lastBellResult} nameOf={nameOf} />}
      {error && ERROR_KO[error] && <div className="toast-error">{ERROR_KO[error]}</div>}

      <div className="turn-indicator">
        {room.bellPending
          ? '🔔 판정 중…'
          : myPlayer.eliminated
            ? '탈락했어요 · 관전 중'
            : isMyTurn && myPlayer.cardCount === 0
              ? '카드가 없어요 · 종을 칠 기회만 남았어요'
              : isMyTurn
                ? '내 차례예요'
                : `${nameOf(room.currentTurnPlayerId)}의 차례`}
        {!room.bellPending && !myPlayer.eliminated && remaining !== null && (
          <span className="turn-countdown"> {remaining}초</span>
        )}
      </div>

      <EmojiPicker onPick={handleEmojiPick} />

      <CardStack
        cardCount={myPlayer.cardCount}
        canFlip={isMyTurn && !myPlayer.eliminated && !room.bellPending}
        onFlip={handleFlip}
        label="내 카드"
      />
    </div>
  );
}

function EmojiPicker({ onPick }: { onPick: (emoji: ReactionEmoji) => void }) {
  return (
    <div className="emoji-picker">
      {REACTIONS.map((e) => (
        <button key={e} className="emoji-picker-button" onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}

function PauseOverlay({
  result,
  nameOf,
}: {
  result: NonNullable<RoomPublicState['lastBellResult']>;
  nameOf: (id: string | null) => string;
}) {
  const ringerName = result.winnerId ? nameOf(result.winnerId) : nameOf(result.penalizedIds[0]);

  return (
    <div className="pause-overlay">
      <div className="pause-card">
        <p>
          🔔 <b>{ringerName}</b>님이 종을 쳤어요!
        </p>
        <p>
          {result.winnerId
            ? `${result.fruit ? FRUIT_KO[result.fruit] : ''} 5개 정답 — ${result.tookCards}장 획득!`
            : '땡, 못 맞췄어요 — 다른 사람들에게 카드 1장씩 나눠줘요'}
        </p>
      </div>
    </div>
  );
}

/** 초대 QR + 링크 복사/공유 - 대기실과 게임 종료 화면(다음 판 초대)에서 같이 씀 */
function InviteBox({ code }: { code: string }) {
  const inviteUrl = `${location.origin}/room/${code}`;
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator.share === 'function';

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function shareLink() {
    navigator.share({ title: '🔔 할리갈리', text: `할리갈리 방 코드 ${code} - 같이 해요!`, url: inviteUrl }).catch(() => {});
  }

  return (
    <>
      <QrCode text={inviteUrl} />
      <div className="invite-row">
        <button className="gate-button gate-button-secondary invite-button" onClick={copyLink}>
          {copied ? '복사됨!' : '초대 링크 복사'}
        </button>
        {canShare && (
          <button className="gate-button gate-button-secondary invite-button" onClick={shareLink}>
            공유하기
          </button>
        )}
      </div>
    </>
  );
}

function PlayerList({ players, me }: { players: PublicPlayer[]; me: string }) {
  return (
    <ul className="waiting-list">
      {players.map((p) => (
        <li key={p.id}>
          <span className={`dot ${p.connected ? 'dot-on' : 'dot-off'}`} />
          {p.name}
          {p.isHost ? ' 👑' : ''}
          {p.id === me ? ' (나)' : ''}
        </li>
      ))}
    </ul>
  );
}

function WaitingRoom({
  room,
  me,
  code,
  onStart,
  onSetTurnLimit,
  onLeave,
  error,
}: {
  room: RoomPublicState;
  me: string;
  code: string;
  onStart: () => void;
  onSetTurnLimit: (sec: number) => void;
  onLeave: () => void;
  error: string | null;
}) {
  const myPlayer = room.players.find((p) => p.id === me);

  return (
    <div className="gate">
      <div className="gate-card">
        <h1>🔔 할리갈리</h1>
        <p className="gate-title">방 코드 {code}</p>

        {myPlayer?.isHost ? (
          <label className="turn-limit-label">
            턴 제한시간: <b>{room.turnTimeLimitSec}초</b>
            <input
              className="turn-limit-range"
              type="range"
              min={MIN_TURN_SEC}
              max={MAX_TURN_SEC}
              value={room.turnTimeLimitSec}
              onChange={(e) => onSetTurnLimit(Number(e.target.value))}
            />
          </label>
        ) : (
          <p className="gate-hint">턴 제한시간: {room.turnTimeLimitSec}초</p>
        )}

        <InviteBox code={code} />
        <PlayerList players={room.players} me={me} />
        {myPlayer?.isHost ? (
          <button className="gate-button" disabled={room.players.length < 2} onClick={onStart}>
            게임 시작 ({room.players.length}/{MAX_PLAYERS})
          </button>
        ) : (
          <p className="gate-hint">방장이 시작하기를 기다리는 중…</p>
        )}
        <button className="gate-button gate-button-secondary" onClick={onLeave}>
          방 나가기
        </button>
        {error && ERROR_KO[error] && <div className="toast-error">{ERROR_KO[error]}</div>}

        <details className="rules" open>
          <summary>게임 방법</summary>
          <ul>
            <li>각자 차례가 되면 자기 카드 더미의 맨 위 카드를 뒤집어 자기 자리 앞에 냅니다.</li>
            <li>새로 내면 <b>이전에 냈던 카드는 덮여서 사라져요</b> — 계산에는 지금 보이는 맨 위 카드만 씁니다.</li>
            <li>모든 사람이 지금 내놓은 카드 중 <b>같은 과일</b>끼리 개수를 더해보세요.</li>
            <li>그 합이 정확히 <b>5</b>가 되는 순간 — 종을 가장 먼저 치면 그동안 각자 앞에 쌓여있던(덮인 것 포함) 카드를 전부 가져가고, 다음 차례는 내가 시작해요.</li>
            <li>합이 5가 아닐 때 종을 치면 벌칙으로 다른 사람들에게 내 카드를 한 장씩 나눠줘야 해요.</li>
            <li>카드가 0장인 채로 자기 차례가 오면 2초 동안 종을 칠 기회가 있고, 그 안에 못 가져오면 탈락 — 이미 낸 카드는 계속 합산에 쓰여요.</li>
            <li>모든 카드를 혼자 다 모으거나, 남은 사람이 나 혼자면 승리!</li>
          </ul>
        </details>
      </div>
    </div>
  );
}

function EndedScreen({
  room,
  me,
  code,
  onRestart,
  onLeave,
  error,
}: {
  room: RoomPublicState;
  me: string;
  code: string;
  onRestart: () => void;
  onLeave: () => void;
  error: string | null;
}) {
  const winner = room.players.find((p) => p.id === room.winnerId);
  const myPlayer = room.players.find((p) => p.id === me);
  return (
    <div className="gate">
      <div className="gate-card">
        <h1>🏆 게임 종료</h1>
        <p className="gate-title">
          {winner?.name ?? '알 수 없음'}
          {room.winnerId === me ? ' (나) 승리!' : ' 승리!'}
        </p>
        <p className="gate-hint">다음 판에 친구를 더 부를 수 있어요</p>
        <InviteBox code={code} />
        <PlayerList players={room.players} me={me} />
        {myPlayer?.isHost ? (
          <button className="gate-button" disabled={room.players.length < 2} onClick={onRestart}>
            다시 플레이 ({room.players.length}/{MAX_PLAYERS})
          </button>
        ) : (
          <p className="gate-hint">방장이 다시 시작하기를 기다리는 중…</p>
        )}
        <button className="gate-button gate-button-secondary" onClick={onLeave}>
          방 나가기
        </button>
        {error && ERROR_KO[error] && <div className="toast-error">{ERROR_KO[error]}</div>}
      </div>
    </div>
  );
}
