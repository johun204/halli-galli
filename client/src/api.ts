import type { MatchServerMessage, RoomPublicState } from '../../shared/types';

// 최근 이만큼의 측정 중 왕복지연이 가장 짧았던 것의 오프셋을 씀 - 측정할 때마다 보정값이 튀지 않게
const CLOCK_SAMPLES = 10;
let clockSamples: { rtt: number; offset: number }[] = [];
let offsetMs = 0;

/**
 * 서버-클라이언트 시계 오프셋 동기화 (Cristian's algorithm).
 * 판정하는 서버(Durable Object)와 웹소켓 ping/pong으로 직접 재서 실제 종 신호가 오가는 경로와 같은 조건으로 맞춤.
 */
export function recordClockSample(t0: number, t1: number, serverTime: number) {
  clockSamples = [...clockSamples, { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 }].slice(-CLOCK_SAMPLES);
  offsetMs = clockSamples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset;
}

/** 지금 이 순간을 서버 기준 시각으로 보정한 값. 종치기 판정에 사용. */
export function correctedNow(): number {
  return Date.now() + offsetMs;
}

export interface Identity {
  playerId: string;
  secret: string;
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'REQUEST_FAILED');
  return data;
}

export function createRoom(name: string) {
  return call<{ playerId: string; secret: string; room: RoomPublicState }>('/api/rooms', { name });
}

export function joinRoom(code: string, name: string) {
  return call<{ playerId: string; secret: string; room: RoomPublicState }>(`/api/rooms/${code}/join`, { name });
}

export function wsUrl(code: string, id: Identity): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/api/rooms/${code}/ws?playerId=${id.playerId}&secret=${id.secret}`;
}

export interface RoomStatus {
  valid: boolean;
  phase?: RoomPublicState['phase'];
  connected?: boolean;
}

/** 재접속 가능 여부 확인용. 웹소켓을 열지 않으므로 "접속 중" 상태를 건드리지 않음. */
export async function checkRoomStatus(code: string, id: Identity): Promise<RoomStatus> {
  const qs = new URLSearchParams({ playerId: id.playerId, secret: id.secret });
  const res = await fetch(`/api/rooms/${code}/status?${qs}`);
  return res.json();
}

// 프록시가 유휴 웹소켓을 끊지 않도록 주기적으로 보내는 문자열 (서버 런타임이 'pong'으로 자동 응답)
const MATCH_KEEPALIVE = 'ping';
const MATCH_KEEPALIVE_MS = 20_000;

/**
 * 랜덤 매칭 대기열에 들어감. 반환값을 호출하면 취소(대기열에서 빠짐).
 * 서버가 공개 방에 넣어주거나 새 방을 만들어주면 onMatched로 그 방 신원이 옴.
 */
export function startMatching(
  name: string,
  handlers: {
    onWaiting: (waiting: number) => void;
    onMatched: (code: string, id: Identity) => void;
    onError: (code: string) => void;
  },
): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/api/match/ws?${new URLSearchParams({ name })}`);
  let finished = false;
  const keepalive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send(MATCH_KEEPALIVE);
  }, MATCH_KEEPALIVE_MS);

  ws.onmessage = (ev) => {
    if (ev.data === 'pong') return;
    let msg: MatchServerMessage;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'waiting') handlers.onWaiting(msg.waiting);
    else if (msg.type === 'matched') {
      finished = true;
      handlers.onMatched(msg.code, { playerId: msg.playerId, secret: msg.secret });
    } else if (msg.type === 'error') {
      finished = true;
      handlers.onError(msg.error);
      ws.close();
    }
  };
  ws.onclose = () => {
    clearInterval(keepalive);
    if (!finished) {
      finished = true;
      handlers.onError('MATCH_DISCONNECTED');
    }
  };

  return () => {
    finished = true;
    clearInterval(keepalive);
    ws.close();
  };
}
