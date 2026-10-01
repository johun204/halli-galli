import { useEffect, useRef, useState } from 'react';
import { correctedNow, type Identity } from '../api';
import { useRoom } from '../hooks/useRoom';
import { FRUIT_KO, GAME_ERROR_KO } from '../messages';
import { isMuted, playBellSound, setMuted } from '../sound';
import { REACTIONS } from '../../../shared/types';
import type { ReactionEmoji, RoomPublicState } from '../../../shared/types';
import { CardStack } from './CardStack';
import { EndedScreen, WaitingRoom } from './RoomLobby';
import { RulesSheet } from './Rules';
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
  const {
    room,
    error,
    connected,
    unreachable,
    lastEmoji,
    me,
    start,
    flip,
    ringBell,
    sendEmoji,
    setTurnLimit,
    setPublic,
    leave,
  } = useRoom(code, identity);
  // Hooks는 항상 같은 순서로 호출되어야 하므로, 아래의 phase별 조건부 return보다 먼저 호출한다.
  const remaining = useCountdown(room?.turnDeadline ?? null);
  const [myReaction, setMyReaction] = useState<{ id: number; emoji: ReactionEmoji } | null>(null);
  const [pendingFlip, setPendingFlip] = useState(false);
  const lastLocalRingAt = useRef(0);
  const [showRules, setShowRules] = useState(false);
  const [muted, setMutedState] = useState(isMuted);

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

  const playing = room?.phase === 'playing';
  const meNow = room?.players.find((p) => p.id === me);
  const myTurnNow = playing && room?.currentTurnPlayerId === me && !meNow?.eliminated;
  const canFlipNow = !!myTurnNow && !room?.bellPending && !room?.paused && !pendingFlip && (meNow?.cardCount ?? 0) > 0;

  // 내 차례가 오면 짧게 진동 - 화면을 계속 보고 있지 않아도 알 수 있게
  useEffect(() => {
    if (myTurnNow && navigator.vibrate) navigator.vibrate([18, 60, 18]);
  }, [myTurnNow]);

  // 키보드(PC): 스페이스/엔터 = 종, 위 화살표/F = 카드 내기. 최신 상태를 쓰도록 ref로 핸들러를 들고 있음
  const keyHandlers = useRef({ ring: () => {}, flip: () => {} });
  useEffect(() => {
    if (!playing) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (document.querySelector('.sheet')) return; // 게임 방법을 보는 중엔 단축키 무시
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        keyHandlers.current.ring();
      } else if (e.code === 'ArrowUp' || e.code === 'KeyF') {
        e.preventDefault();
        keyHandlers.current.flip();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing]);

  // 방이 없어졌거나(오래 끊겨서 정리됨) 같은 코드로 완전히 다른 방이 생긴 경우 - 더 기다려도 소용없으니 홈으로
  useEffect(() => {
    if (unreachable) onUnreachable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreachable]);

  function handleLeave() {
    leave();
    onLeave();
  }

  const reconnectBanner = !connected && room && (
    <div className="toast-error toast-reconnect">연결이 끊겼어요, 다시 연결하는 중…</div>
  );

  if (unreachable || !room)
    return (
      <div className="loading">
        <div className="matching-spinner" />
        방에 연결하는 중…
      </div>
    );
  if (room.phase === 'lobby')
    return (
      <>
        {reconnectBanner}
        <WaitingRoom
        room={room}
        me={me}
        code={code}
        onStart={start}
        onSetTurnLimit={setTurnLimit}
        onSetPublic={setPublic}
        onLeave={handleLeave}
        error={error}
        />
      </>
    );
  if (room.phase === 'ended')
    return (
      <>
        {reconnectBanner}
        <EndedScreen
        room={room}
        me={me}
        code={code}
        onRestart={start}
        onSetPublic={setPublic}
        onLeave={handleLeave}
        error={error}
        />
      </>
    );

  const myPlayer = room.players.find((p) => p.id === me)!;
  const isMyTurn = room.currentTurnPlayerId === me;
  const nameOf = (id: string | null) => room.players.find((p) => p.id === id)?.name ?? '';

  function handleFlip() {
    if (!canFlipNow) return; // 서버 응답 전 연속으로 밀어서 "내 차례 아님" 오류가 나는 걸 막음
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

  keyHandlers.current = { ring: handleRing, flip: handleFlip };

  function handleEmojiPick(emoji: ReactionEmoji) {
    setMyReaction({ id: ++localEventId, emoji });
    sendEmoji(emoji);
  }

  return (
    <div className="board">
      {reconnectBanner}

      <div className="board-topbar">
        <span className="room-chip">방 {code}</span>
        <div className="board-topbar-actions">
          <button
            className="icon-button"
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
            }}
            aria-label={muted ? '소리 켜기' : '소리 끄기'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <button className="icon-button" onClick={() => setShowRules(true)} aria-label="게임 방법">
            ?
          </button>
        </div>
      </div>

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
      {error && GAME_ERROR_KO[error] && <div className="toast-error">{GAME_ERROR_KO[error]}</div>}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}

      <div className={`turn-indicator ${isMyTurn && !myPlayer.eliminated && !room.bellPending ? 'turn-indicator-me' : ''}`}>
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

      <CardStack cardCount={myPlayer.cardCount} canFlip={canFlipNow} onFlip={handleFlip} label="내 카드" />
      <div className="keyboard-hint">스페이스: 종 치기 · ↑: 카드 내기</div>
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
