import { useEffect, useMemo, useState } from 'react';
import type { EmojiEvent } from '../hooks/useRoom';
import type { BellResult, PublicPlayer, ReactionEmoji } from '../../../shared/types';
import { Bell } from './Bell';
import { CardBack, CardFace } from './Card';
import { PlayerBadge } from './PlayerBadge';

const FLIGHT_MS = 550;
const BUBBLE_MS = 1600;

interface Point {
  x: number;
  y: number;
}

interface Flight {
  key: string;
  from: Point;
  to: Point;
  phase: 'start' | 'end';
}

/** 원형 테이블: 나는 항상 6시(맨 아래), 나머지는 시계방향으로 배치 */
function seatOrder(players: PublicPlayer[], me: string): PublicPlayer[] {
  const meIdx = players.findIndex((p) => p.id === me);
  if (meIdx === -1) return players;
  return [...players.slice(meIdx), ...players.slice(0, meIdx)];
}

export function Table({
  players,
  me,
  currentTurnPlayerId,
  turnRemainingSec,
  lastBellResult,
  lastEmoji,
  myReaction,
  myPendingFlip,
  bellPending,
  serverNow,
  onRing,
}: {
  players: PublicPlayer[];
  me: string;
  currentTurnPlayerId: string | null;
  turnRemainingSec: number | null;
  lastBellResult: BellResult | null;
  lastEmoji: EmojiEvent | null;
  myReaction: { id: number; emoji: ReactionEmoji } | null;
  myPendingFlip: boolean;
  bellPending: boolean;
  serverNow: number;
  onRing: () => void;
}) {
  const seats = seatOrder(players, me);
  const n = seats.length;

  const positions = useMemo(() => {
    const map = new Map<string, { seat: Point; card: Point }>();
    seats.forEach((p, i) => {
      const angle = 90 + (360 / n) * i;
      const rad = (angle * Math.PI) / 180;
      map.set(p.id, {
        seat: { x: 50 + 42 * Math.cos(rad), y: 50 + 42 * Math.sin(rad) },
        card: { x: 50 + 22 * Math.cos(rad), y: 50 + 22 * Math.sin(rad) },
      });
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats.map((p) => p.id).join(','), n]);

  const [flights, setFlights] = useState<Flight[]>([]);

  useEffect(() => {
    if (!lastBellResult) return;
    const built: Flight[] = [];

    if (lastBellResult.winnerId) {
      const to = positions.get(lastBellResult.winnerId)?.seat;
      if (to) {
        // 실제로 카드를 내놓은 상태였던 사람에게서만 이펙트가 출발함 (안 낸 사람은 제외)
        for (const pid of lastBellResult.contributorIds) {
          const from = positions.get(pid)?.card;
          if (from) built.push({ key: `${lastBellResult.id}-${pid}`, from, to, phase: 'start' });
        }
      }
    } else if (lastBellResult.penalizedIds[0]) {
      const from = positions.get(lastBellResult.penalizedIds[0])?.seat;
      if (from) {
        for (const p of players) {
          if (p.id === lastBellResult.penalizedIds[0] || p.eliminated) continue; // 탈락자는 벌칙 카드를 안 받음
          const to = positions.get(p.id)?.seat;
          if (to) built.push({ key: `${lastBellResult.id}-${p.id}`, from, to, phase: 'start' });
        }
      }
    }

    if (built.length === 0) return;
    setFlights(built);
    const raf = requestAnimationFrame(() => setFlights((fs) => fs.map((f) => ({ ...f, phase: 'end' }))));
    const clear = setTimeout(() => setFlights([]), FLIGHT_MS + 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastBellResult?.id]);

  // 다른 사람의 이모지는 서버 브로드캐스트로, 내 이모지는 누르는 즉시 로컬에서(지연 없이) 반영
  const [othersBubble, setOthersBubble] = useState<{ id: number; playerId: string; emoji: string } | null>(null);
  useEffect(() => {
    if (!lastEmoji || lastEmoji.playerId === me) return;
    setOthersBubble(lastEmoji);
    const t = setTimeout(() => setOthersBubble(null), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [lastEmoji?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [myBubble, setMyBubble] = useState<{ id: number; emoji: string } | null>(null);
  useEffect(() => {
    if (!myReaction) return;
    setMyBubble(myReaction);
    const t = setTimeout(() => setMyBubble(null), BUBBLE_MS);
    return () => clearTimeout(t);
  }, [myReaction?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="table">
      <div className="table-ring">
        <div className={`table-bell ${bellPending ? 'table-bell-pending' : ''}`}>
          <Bell onRing={onRing} />
        </div>

        {seats.map((p) => {
          const pos = positions.get(p.id)!;
          const thickness = Math.min(p.playedCount, 4);
          const isMe = p.id === me;
          const bubbleEmoji = isMe ? myBubble?.emoji : othersBubble?.playerId === p.id ? othersBubble.emoji : null;
          const bubbleKey = isMe ? myBubble?.id : othersBubble?.playerId === p.id ? othersBubble.id : null;
          const showFlipping = isMe && myPendingFlip;

          return (
            <div key={p.id}>
              <div className={`seat ${p.eliminated ? 'seat-eliminated' : ''}`} style={{ left: `${pos.seat.x}%`, top: `${pos.seat.y}%` }}>
                {bubbleEmoji && (
                  <div key={bubbleKey} className="emoji-bubble">
                    {bubbleEmoji}
                  </div>
                )}
                <PlayerBadge player={p} isMe={isMe} isTurn={currentTurnPlayerId === p.id} serverNow={serverNow} />
                {currentTurnPlayerId === p.id && turnRemainingSec !== null && (
                  <span className={`turn-badge ${turnRemainingSec <= 3 ? 'turn-badge-urgent' : ''}`}>{turnRemainingSec}</span>
                )}
              </div>
              <div className="play-slot" style={{ left: `${pos.card.x}%`, top: `${pos.card.y}%` }}>
                {showFlipping ? (
                  // 서버 응답을 기다리는 동안 카드 자리를 비워두지 않고 뒤집는 중 표시를 보여줌 (끊김 방지)
                  <div className="play-slot-card flip-in">
                    <CardBack />
                  </div>
                ) : p.playedTop ? (
                  <div className="play-slot-stack">
                    {Array.from({ length: thickness - 1 }).map((_, i) => (
                      <div key={i} className="stack-layer play-slot-layer" style={{ transform: `translate(${i * 2}px, ${-i * 2.5}px) scale(0.92)` }} />
                    ))}
                    <div key={p.playedTop.id} className="play-slot-card flip-in">
                      <CardFace card={p.playedTop} />
                    </div>
                  </div>
                ) : (
                  <div className="play-slot-empty" />
                )}
              </div>
            </div>
          );
        })}

        {flights.map((f) => {
          const pt = f.phase === 'end' ? f.to : f.from;
          return <div key={f.key} className="flying-card" style={{ left: `${pt.x}%`, top: `${pt.y}%` }} />;
        })}
      </div>
    </div>
  );
}
