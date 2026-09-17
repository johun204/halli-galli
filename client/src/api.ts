import type { RoomPublicState } from '../../shared/types';

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
