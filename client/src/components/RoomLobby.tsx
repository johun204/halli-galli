import { useState, type ReactNode } from 'react';
import { MAX_PLAYERS, MAX_TURN_SEC, MIN_TURN_SEC } from '../../../shared/types';
import type { PublicPlayer, RoomPublicState } from '../../../shared/types';
import { GAME_ERROR_KO } from '../messages';
import { QrCode } from './QrCode';
import { RulesSheet } from './Rules';

/** 대기실/종료 화면 공통 뼈대: 위 헤더(나가기·제목·도움말) + 스크롤되는 본문 + 아래 고정 버튼 영역 */
function Screen({
  title,
  onLeave,
  actions,
  error,
  children,
}: {
  title: string;
  onLeave: () => void;
  actions: ReactNode;
  error: string | null;
  children: ReactNode;
}) {
  const [showRules, setShowRules] = useState(false);

  function confirmLeave() {
    if (window.confirm('방에서 나갈까요?')) onLeave();
  }

  return (
    <div className="screen">
      <header className="screen-header">
        <button className="header-button" onClick={confirmLeave}>
          ← 나가기
        </button>
        <h1>{title}</h1>
        <button className="icon-button" onClick={() => setShowRules(true)} aria-label="게임 방법">
          ?
        </button>
      </header>
      <main className="screen-body">{children}</main>
      <div className="action-bar">{actions}</div>
      {error && GAME_ERROR_KO[error] && <div className="toast-error toast-above-bar">{GAME_ERROR_KO[error]}</div>}
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
    </div>
  );
}

function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  function copy(text: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }
  return [copied, copy];
}

/** 방 코드(눌러서 복사) + 초대 링크 복사/공유 + 접어둔 QR */
function InviteCard({ code, compact = false }: { code: string; compact?: boolean }) {
  const inviteUrl = `${location.origin}/room/${code}`;
  const [codeCopied, copyCode] = useCopied();
  const [linkCopied, copyLink] = useCopied();
  const canShare = typeof navigator.share === 'function';

  function shareLink() {
    navigator.share({ title: '🔔 할리갈리', text: `할리갈리 방 코드 ${code} - 같이 해요!`, url: inviteUrl }).catch(() => {});
  }

  return (
    <section className="panel invite-card">
      {!compact && (
        <button className="room-code" onClick={() => copyCode(code)} aria-label={`방 코드 ${code} 복사`}>
          <span className="room-code-label">방 코드</span>
          <span className="room-code-digits">{code}</span>
          <span className="room-code-hint">{codeCopied ? '복사됐어요!' : '눌러서 복사'}</span>
        </button>
      )}
      <div className="invite-row">
        <button className="pill-button" onClick={() => copyLink(inviteUrl)}>
          {linkCopied ? '✓ 복사됨' : '🔗 초대 링크 복사'}
        </button>
        {canShare && (
          <button className="pill-button" onClick={shareLink}>
            📤 공유하기
          </button>
        )}
      </div>
      <details className="qr-details">
        <summary>QR 코드로 초대하기</summary>
        <QrCode text={inviteUrl} />
      </details>
    </section>
  );
}

/** 참가자 목록 - 빈 자리까지 보여줘서 몇 명 더 들어올 수 있는지 한눈에 */
function PlayerSlots({ players, me }: { players: PublicPlayer[]; me: string }) {
  return (
    <section className="panel">
      <h3 className="panel-title">
        참가자 <span className="panel-count">{players.length}/{MAX_PLAYERS}</span>
      </h3>
      <ul className="slot-list">
        {players.map((p) => (
          <li key={p.id} className={`slot ${p.id === me ? 'slot-me' : ''}`}>
            <span className="slot-avatar">{p.name.slice(0, 1)}</span>
            <span className="slot-name">
              {p.name}
              {p.id === me && <span className="tag tag-me">나</span>}
              {p.isHost && <span className="tag tag-host">👑 방장</span>}
            </span>
            <span className={`dot ${p.connected ? 'dot-on' : 'dot-off'}`} title={p.connected ? '접속 중' : '연결 끊김'} />
          </li>
        ))}
      </ul>
      {players.length < MAX_PLAYERS && (
        <div className="empty-seats" aria-label={`빈 자리 ${MAX_PLAYERS - players.length}개`}>
          {Array.from({ length: MAX_PLAYERS - players.length }).map((_, i) => (
            <span key={i} className="empty-seat">
              +
            </span>
          ))}
          <span className="empty-seats-text">빈 자리 {MAX_PLAYERS - players.length}개 · 초대해보세요</span>
        </div>
      )}
    </section>
  );
}

/** 방 설정: 초대코드 없이 랜덤 매칭으로 모르는 사람이 들어올 수 있게 할지 (방장만 바꿀 수 있음) */
function PublicToggle({
  isPublic,
  isHost,
  onChange,
}: {
  isPublic: boolean;
  isHost: boolean;
  onChange: (isPublic: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <b>모르는 사람 참여 허용</b>
        <span>{isPublic ? '랜덤 매칭으로 초대코드 없이 들어올 수 있어요' : '초대코드/링크를 아는 사람만 들어올 수 있어요'}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={isPublic}
        aria-label="모르는 사람 참여 허용"
        className={`switch ${isPublic ? 'switch-on' : ''}`}
        disabled={!isHost}
        onClick={() => onChange(!isPublic)}
      />
    </div>
  );
}

function Settings({
  room,
  isHost,
  onSetTurnLimit,
  onSetPublic,
}: {
  room: RoomPublicState;
  isHost: boolean;
  onSetTurnLimit?: (sec: number) => void;
  onSetPublic: (isPublic: boolean) => void;
}) {
  return (
    <section className="panel">
      <h3 className="panel-title">
        방 설정 {!isHost && <span className="panel-note">방장만 바꿀 수 있어요</span>}
      </h3>
      {onSetTurnLimit && (
        <div className="setting-row setting-row-column">
          <div className="setting-text">
            <b>턴 제한시간 · {room.turnTimeLimitSec}초</b>
            <span>시간 안에 안 내면 자동으로 카드가 나가요</span>
          </div>
          <input
            className="turn-limit-range"
            type="range"
            min={MIN_TURN_SEC}
            max={MAX_TURN_SEC}
            value={room.turnTimeLimitSec}
            disabled={!isHost}
            onChange={(e) => onSetTurnLimit(Number(e.target.value))}
            aria-label="턴 제한시간"
          />
        </div>
      )}
      <PublicToggle isPublic={room.isPublic} isHost={isHost} onChange={onSetPublic} />
    </section>
  );
}

/** 아래 고정 영역: 방장은 시작 버튼, 나머지는 기다리는 중 안내 */
function StartActions({ room, isHost, label, onStart }: { room: RoomPublicState; isHost: boolean; label: string; onStart: () => void }) {
  const need = 2 - room.players.length;
  if (!isHost) {
    return (
      <p className="action-wait">
        <span className="typing-dots">
          <i />
          <i />
          <i />
        </span>
        방장이 시작하기를 기다리는 중
      </p>
    );
  }
  return (
    <>
      {need > 0 && <p className="action-hint">{need}명 더 들어오면 시작할 수 있어요</p>}
      <button className="gate-button action-main" disabled={need > 0} onClick={onStart}>
        {label} ({room.players.length}명)
      </button>
    </>
  );
}

export function WaitingRoom({
  room,
  me,
  code,
  onStart,
  onSetTurnLimit,
  onSetPublic,
  onLeave,
  error,
}: {
  room: RoomPublicState;
  me: string;
  code: string;
  onStart: () => void;
  onSetTurnLimit: (sec: number) => void;
  onSetPublic: (isPublic: boolean) => void;
  onLeave: () => void;
  error: string | null;
}) {
  const isHost = !!room.players.find((p) => p.id === me)?.isHost;
  return (
    <Screen
      title="대기실"
      onLeave={onLeave}
      error={error}
      actions={<StartActions room={room} isHost={isHost} label="게임 시작" onStart={onStart} />}
    >
      <InviteCard code={code} />
      <PlayerSlots players={room.players} me={me} />
      <Settings room={room} isHost={isHost} onSetTurnLimit={onSetTurnLimit} onSetPublic={onSetPublic} />
    </Screen>
  );
}

/** 최종 순위: 승자 먼저, 그다음 남은 카드가 많은 순, 탈락자는 맨 뒤 */
function rankPlayers(room: RoomPublicState): PublicPlayer[] {
  const score = (p: PublicPlayer) => (p.id === room.winnerId ? 1e6 : 0) + (p.eliminated ? -1e3 : 0) + p.cardCount;
  return [...room.players].sort((a, b) => score(b) - score(a));
}

export function EndedScreen({
  room,
  me,
  code,
  onRestart,
  onSetPublic,
  onLeave,
  error,
}: {
  room: RoomPublicState;
  me: string;
  code: string;
  onRestart: () => void;
  onSetPublic: (isPublic: boolean) => void;
  onLeave: () => void;
  error: string | null;
}) {
  const winner = room.players.find((p) => p.id === room.winnerId);
  const isHost = !!room.players.find((p) => p.id === me)?.isHost;
  const iWon = room.winnerId === me;
  return (
    <Screen
      title="게임 종료"
      onLeave={onLeave}
      error={error}
      actions={<StartActions room={room} isHost={isHost} label="다시 플레이" onStart={onRestart} />}
    >
      <section className={`panel winner-hero ${iWon ? 'winner-hero-me' : ''}`}>
        <div className="winner-trophy">🏆</div>
        <p className="winner-name">{iWon ? '내가 이겼어요!' : `${winner?.name ?? '알 수 없음'} 승리!`}</p>
      </section>

      <section className="panel">
        <h3 className="panel-title">최종 순위</h3>
        <ol className="rank-list">
          {rankPlayers(room).map((p, i) => (
            <li key={p.id} className={`rank ${p.id === me ? 'slot-me' : ''}`}>
              <span className="rank-no">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
              <span className="slot-name">
                {p.name}
                {p.id === me && <span className="tag tag-me">나</span>}
                {p.isHost && <span className="tag tag-host">👑</span>}
              </span>
              <span className="rank-cards">{p.eliminated ? '탈락' : `${p.cardCount}장`}</span>
            </li>
          ))}
        </ol>
      </section>

      <p className="section-caption">다음 판에 친구를 더 부를 수 있어요 (방 코드 {code})</p>
      <InviteCard code={code} compact />
      <Settings room={room} isHost={isHost} onSetPublic={onSetPublic} />
    </Screen>
  );
}
