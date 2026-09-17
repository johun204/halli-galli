import type { RoomPublicState } from './types';

let offsetMs = 0;

/** 서버-클라이언트 시계 오프셋 동기화 (Cristian's algorithm). RTT가 가장 짧은 샘플을 채택. */
export async function syncClock(samples = 5): Promise<void> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await fetch('/api/time');
    const data = await res.json();
    const t1 = Date.now();
    const rtt = t1 - t0;
    const offset = data.serverTime - (t0 + t1) / 2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  if (best) offsetMs = best.offset;
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
