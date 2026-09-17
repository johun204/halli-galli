import { useEffect, useRef, useState } from 'react';
import { checkRoomStatus, createRoom, joinRoom, type Identity } from './api';
import { GameBoard } from './components/GameBoard';
import { NameGate } from './components/Lobby';
import { MAX_PLAYERS } from '../../shared/types';
import { clearLastRoom, forgetRoom, loadIdentity, loadLastName, loadLastRoom, saveIdentity, saveLastName } from './identity';

const ERROR_KO: Record<string, string> = {
  EMPTY_NAME: '닉네임을 입력해주세요',
  ROOM_NOT_FOUND: '존재하지 않는 초대코드예요',
  ROOM_UNREACHABLE: '방에 접속할 수 없어요. 방이 사라졌거나 만료됐을 수 있어요',
  ROOMS_EXHAUSTED: '지금은 방을 만들 수 없어요. 잠시 후 다시 시도해주세요',
  ROOM_FULL: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)`,
  ALREADY_STARTED: '지금 게임 중인 방이에요. 판이 끝나면 들어올 수 있어요',
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
  const { toast, show } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div>
      <div className="gate">
        <div className="gate-card">
          <h1>🔔 할리갈리</h1>

          {resumeCode && (
            <div className="resume-banner">
              <p>진행 중이던 방 {resumeCode}이 있어요</p>
              <button className="gate-button resume-button" onClick={() => navigate(`/room/${resumeCode}`)}>
                이어서 하기
              </button>
            </div>
          )}

          <p className="gate-title">닉네임을 입력하세요</p>
          <input
            ref={nameInputRef}
            className="gate-input"
            placeholder="닉네임"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />

          <button className="gate-button" disabled={busy} onClick={handleCreate}>
            {busy ? '처리 중…' : '방 만들기'}
          </button>

          <div className="code-join">
            <p className="code-join-label">또는 초대코드로 바로 입장</p>
            <div className="code-join-row">
              <input
                className="gate-input code-join-input"
                placeholder="0000"
                value={code}
                inputMode="numeric"
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
          </div>
        </div>
      </div>
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
        title={`"${code}" 방에 참가할 닉네임을 입력하세요`}
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
          새로운 방 만들기
        </button>
      </NameGate>
      {toast && <div className="toast-error">{toast}</div>}
    </div>
  );
}
