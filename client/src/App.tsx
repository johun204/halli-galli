import { useEffect, useRef, useState } from 'react';
import { checkRoomStatus, createRoom, joinRoom, startMatching, type Identity } from './api';
import { GameBoard } from './components/GameBoard';
import { NameGate } from './components/Lobby';
import { RulesSheet } from './components/Rules';
import { MAX_PLAYERS } from '../../shared/types';
import { clearLastRoom, forgetRoom, loadIdentity, loadLastName, loadLastRoom, saveIdentity, saveLastName } from './identity';

const ERROR_KO: Record<string, string> = {
  EMPTY_NAME: '닉네임을 입력해주세요',
  ROOM_NOT_FOUND: '존재하지 않는 초대코드예요',
  ROOM_UNREACHABLE: '방에 접속할 수 없어요. 방이 사라졌거나 만료됐을 수 있어요',
  ROOMS_EXHAUSTED: '지금은 방을 만들 수 없어요. 잠시 후 다시 시도해주세요',
  ROOM_FULL: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)`,
  ALREADY_STARTED: '지금 게임 중인 방이에요. 판이 끝나면 들어올 수 있어요',
  MATCH_FAILED: '매칭에 실패했어요. 잠시 후 다시 시도해주세요',
  MATCH_DISCONNECTED: '매칭 서버와 연결이 끊겼어요. 다시 시도해주세요',
};

function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(t);
  }, [message]);
  function show(err: unknown) {
    const code = err instanceof Error ? err.message : 'ERROR';
    setMessage(ERROR_KO[code] ?? code);
  }
  return { toast: message, show };
}

function usePathname() {
  const [pathname, setPathname] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPathname(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (path: string) => {
    window.history.pushState(null, '', path);
    setPathname(path);
  };
  return { pathname, navigate };
}

export default function App() {
  const { pathname, navigate } = usePathname();
  const [pendingToastCode, setPendingToastCode] = useState<string | null>(null);
  const roomMatch = pathname.match(/^\/room\/([A-Za-z0-9]+)$/);

  function goHomeWithToast(code: string) {
    setPendingToastCode(code);
    navigate('/');
  }

  if (roomMatch) {
    return (
      <RoomEntry
        code={roomMatch[1].toUpperCase()}
        navigate={navigate}
        onUnreachable={() => goHomeWithToast('ROOM_UNREACHABLE')}
      />
    );
  }

  return <Home navigate={navigate} pendingToastCode={pendingToastCode} onPendingToastShown={() => setPendingToastCode(null)} />;
}

function Home({
  navigate,
  pendingToastCode,
  onPendingToastShown,
}: {
  navigate: (path: string) => void;
  pendingToastCode: string | null;
  onPendingToastShown: () => void;
}) {
  const [name, setName] = useState(loadLastName);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resumeCode, setResumeCode] = useState<string | null>(null);
  // 랜덤 매칭 중이면 지금 대기 중인 인원 수(아직 모르면 0), 아니면 null
  const [matchWaiting, setMatchWaiting] = useState<number | null>(null);
  const cancelMatchRef = useRef<(() => void) | null>(null);
  const { toast, show } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [showRules, setShowRules] = useState(false);

  // 화면을 떠나면 매칭 대기열에서도 빠짐
  useEffect(() => () => cancelMatchRef.current?.(), []);

  useEffect(() => {
    if (!pendingToastCode) return;
    show(new Error(pendingToastCode));
    onPendingToastShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingToastCode]);

  useEffect(() => {
    const lastRoom = loadLastRoom();
    if (!lastRoom) return;
    const savedIdentity = loadIdentity(lastRoom);
    if (!savedIdentity) return;
    checkRoomStatus(lastRoom, savedIdentity)
      .then((status) => {
        // 하이재킹 방지: 이 플레이어가 이미 다른 곳에 접속되어 있으면(진행 중이면) 이어하기를 제안하지 않음
        if (status.valid && status.phase !== 'ended' && !status.connected) {
          setResumeCode(lastRoom);
        } else if (!status.valid) {
          clearLastRoom(); // 같은 코드로 완전히 다른 방이 생겼거나 더는 존재하지 않는 방
        }
      })
      .catch(() => {});
  }, []);

  function commitName(): string {
    const trimmed = name.trim();
    if (trimmed) saveLastName(trimmed);
    return trimmed;
  }

  function requireName(): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      show(new Error('EMPTY_NAME'));
      nameInputRef.current?.focus();
      return null;
    }
    return trimmed;
  }

  async function handleCreate() {
    if (busy) return;
    if (!requireName()) return;
    const trimmed = commitName();
    setBusy(true);
    try {
      const res = await createRoom(trimmed);
      const roomCode = res.room.code;
      saveIdentity(roomCode, { playerId: res.playerId, secret: res.secret });
      navigate(`/room/${roomCode}`);
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  }

  function handleRandomMatch() {
    if (busy || matchWaiting !== null) return;
    if (!requireName()) return;
    const trimmed = commitName();
    setMatchWaiting(0);
    cancelMatchRef.current = startMatching(trimmed, {
      onWaiting: (n) => setMatchWaiting(n),
      onMatched: (roomCode, id) => {
        cancelMatchRef.current = null;
        saveIdentity(roomCode, id);
        navigate(`/room/${roomCode}`);
      },
      onError: (err) => {
        cancelMatchRef.current = null;
        setMatchWaiting(null);
        show(new Error(err));
      },
    });
  }

  function cancelRandomMatch() {
    cancelMatchRef.current?.();
    cancelMatchRef.current = null;
    setMatchWaiting(null);
  }

  async function handleJoinByCode() {
    if (busy || code.length !== 4) return;
    if (!requireName()) return;
    const trimmed = commitName();
    setBusy(true);
    try {
      const res = await joinRoom(code, trimmed);
      const id = { playerId: res.playerId, secret: res.secret };
      saveIdentity(code, id);
      // 코드 입력 시엔 중간 화면 없이 이름 그대로 바로 입장
      navigate(`/room/${code}`);
    } catch (e) {
      show(e);
    } finally {
      setBusy(false);
    }
  }

  const matching = matchWaiting !== null;

  return (
    <div className="screen home">
      <main className="screen-body">
        <div className="home-hero">
          <div className="home-logo">🔔</div>
          <h1>할리갈리</h1>
          <p>같은 과일이 딱 5개가 되면 — 종을 먼저 쳐요!</p>
        </div>

        {resumeCode && !matching && (
          <section className="panel resume-banner">
            <p>진행 중이던 방 {resumeCode}이 있어요</p>
            <button className="gate-button resume-button" onClick={() => navigate(`/room/${resumeCode}`)}>
              이어서 하기
            </button>
          </section>
        )}

        <section className="panel">
          <label className="field-label" htmlFor="nickname">
            닉네임
          </label>
          <input
            id="nickname"
            ref={nameInputRef}
            className="gate-input"
            placeholder="다른 사람에게 보일 이름"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            disabled={matching}
            onChange={(e) => setName(e.target.value)}
          />
        </section>

        {matching ? (
          <section className="panel matching-box">
            <div className="matching-spinner" />
            <p className="matching-title">함께할 사람을 찾는 중…</p>
            <p className="gate-hint">
              {matchWaiting > 1
                ? `나를 포함해 ${matchWaiting}명이 기다리는 중`
                : '참여 가능한 방이 생기거나 다른 사람이 오면 바로 입장해요'}
            </p>
            <button className="gate-button gate-button-secondary" onClick={cancelRandomMatch}>
              매칭 취소
            </button>
          </section>
        ) : (
          <>
            <div className="choice-grid">
              <button className="choice choice-match" disabled={busy} onClick={handleRandomMatch}>
                <span className="choice-icon">🎲</span>
                <b>랜덤 매칭</b>
                <span>아무나와 바로 한 판</span>
              </button>
              <button className="choice choice-create" disabled={busy} onClick={handleCreate}>
                <span className="choice-icon">🏠</span>
                <b>{busy ? '만드는 중…' : '방 만들기'}</b>
                <span>친구를 초대해서</span>
              </button>
            </div>

            <section className="panel code-join">
              <label className="field-label" htmlFor="room-code">
                초대코드로 입장
              </label>
              <div className="code-join-row">
                <input
                  id="room-code"
                  className="gate-input code-join-input"
                  placeholder="0000"
                  value={code}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoinByCode()}
                />
                <button
                  className="gate-button gate-button-secondary code-join-button"
                  disabled={code.length !== 4 || busy}
                  onClick={handleJoinByCode}
                >
                  입장
                </button>
              </div>
            </section>
          </>
        )}

        <button className="link-button" onClick={() => setShowRules(true)}>
          처음이세요? 게임 방법 보기
        </button>
      </main>
      {showRules && <RulesSheet onClose={() => setShowRules(false)} />}
      {toast && <div className="toast-error">{toast}</div>}
    </div>
  );
}

function RoomEntry({
  code,
  navigate,
  onUnreachable,
}: {
  code: string;
  navigate: (path: string) => void;
  onUnreachable: () => void;
}) {
  const [identity, setIdentity] = useState<Identity | null>(() => loadIdentity(code));
  const [busy, setBusy] = useState(false);
  const { toast, show } = useToast();

  if (identity)
    return (
      <GameBoard
        code={code}
        identity={identity}
        onUnreachable={onUnreachable}
        onLeave={() => {
          forgetRoom(code);
          navigate('/');
        }}
      />
    );

  return (
    <div>
      <NameGate
        title={`${code}번 방에 초대받았어요! 사용할 닉네임을 입력하세요`}
        buttonLabel="참가하기"
        busy={busy}
        onSubmit={async (name) => {
          setBusy(true);
          try {
            const res = await joinRoom(code, name);
            const id = { playerId: res.playerId, secret: res.secret };
            saveIdentity(code, id);
            setIdentity(id);
          } catch (e) {
            show(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <button className="gate-button gate-button-secondary" onClick={() => navigate('/')}>
          처음 화면으로
        </button>
      </NameGate>
      {toast && <div className="toast-error">{toast}</div>}
    </div>
  );
}
