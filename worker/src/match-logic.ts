import { MAX_PLAYERS, type PublicRoomSummary } from '../../shared/types';

// 이만큼 아무 소식이 없는 공개 방 기록은 버림 (방이 정리될 때 알림이 유실된 경우 대비)
const STALE_ROOM_MS = 6 * 60 * 60 * 1000;

/**
 * 공개 방 중 랜덤 매칭으로 넣을 방을 고름 (없으면 null).
 * 대기실 우선(게임 종료 후 다음 판 대기 중인 방은 그다음), 같은 조건이면 사람이 많은 방을 먼저 채움.
 */
export function pickRoom(
  rooms: Iterable<PublicRoomSummary>,
  now: number,
  freshUntil: ReadonlyMap<string, number> = new Map(),
): PublicRoomSummary | null {
  let best: PublicRoomSummary | null = null;
  const rank = (r: PublicRoomSummary) => (r.phase === 'lobby' ? 1000 : 0) + r.playerCount;
  for (const r of rooms) {
    if (r.phase === 'playing' || r.playerCount >= MAX_PLAYERS || r.playerCount === 0) continue;
    if (now - r.at > STALE_ROOM_MS) continue;
    // 아무도 접속해 있지 않은 방(버려진 방)에는 넣지 않음
    if (r.connectedCount === 0 && (freshUntil.get(r.code) ?? 0) < now) continue;
    if (!best || rank(r) > rank(best)) best = r;
  }
  return best;
}
