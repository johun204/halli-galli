import { useEffect, useRef, useState } from 'react';
import { checkRoomStatus, correctedNow, recordClockSample, wsUrl, type Identity } from '../api';
import type { ClientMessage, ReactionEmoji, RoomPublicState, ServerMessage } from '../../../shared/types';

const RECONNECT_MS = 1500;
// 접속 직후엔 짧은 간격으로 몇 번 재서 시계 보정값을 빨리 잡고, 이후엔 이 간격으로 갱신
const PING_BURST = 5;
const PING_BURST_MS = 300;
const PING_INTERVAL_MS = 3000;

export interface EmojiEvent {
  id: number;
  playerId: string;
  emoji: ReactionEmoji;
}

export function useRoom(code: string, identity: Identity) {
  const [room, setRoom] = useState<RoomPublicState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEmoji, setLastEmoji] = useState<EmojiEvent | null>(null);
  // 방이 없어졌거나 이 신원이 더 이상 유효하지 않아서 재접속해도 절대 성공하지 않는 상태인지
  const [unreachable, setUnreachable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let pingTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(wsUrl(code, identity));
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        let sent = 0;
        const ping = () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() } satisfies ClientMessage));
          sent++;
          pingTimer = setTimeout(ping, sent < PING_BURST ? PING_BURST_MS : PING_INTERVAL_MS);
        };
        ping();
      };

      ws.onmessage = (ev) => {
        const msg: ServerMessage = JSON.parse(ev.data);
        if (msg.type === 'state') {
          setRoom(msg.room);
          setError(null);
        } else if (msg.type === 'error') {
          setError(msg.error);
        } else if (msg.type === 'emoji') {
          setLastEmoji({ id: msg.id, playerId: msg.playerId, emoji: msg.emoji });
        } else if (msg.type === 'pong') {
          recordClockSample(msg.t, Date.now(), msg.s);
          // 서버가 직접 왕복지연을 잴 수 있게 받은 즉시 서버 시각을 되돌려 보냄
          ws.send(JSON.stringify({ type: 'clockAck', s: msg.s } satisfies ClientMessage));
        }
      };

      ws.onclose = async () => {
        clearTimeout(pingTimer);
        setConnected(false);
        if (cancelled) return;

        // 끊길 때마다 방/신원이 아직 유효한지 확인 - 그 사이 방이 정리됐으면 재시도해도 영원히 실패하므로 중단
        const status = await checkRoomStatus(code, identity).catch(() => null);
        if (cancelled) return;
        if (status && !status.valid) {
          setUnreachable(true);
          return;
        }
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      clearTimeout(pingTimer);
      wsRef.current?.close();
    };
  }, [code, identity.playerId, identity.secret]);

  function send(msg: ClientMessage) {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }

  return {
    room,
    error,
    connected,
    unreachable,
    lastEmoji,
    me: identity.playerId,
    start: () => send({ type: 'start' }),
    flip: () => send({ type: 'flip' }),
    // seenFlipId: 지금 화면에 반영된 마지막 카드 - 서버가 "내 화면 기준"으로 정답 여부를 판정함
    ringBell: () => send({ type: 'bell', correctedServerTime: correctedNow(), seenFlipId: room?.lastFlip?.resultId ?? 0 }),
    sendEmoji: (emoji: ReactionEmoji) => send({ type: 'emoji', emoji }),
    setTurnLimit: (sec: number) => send({ type: 'setTurnLimit', sec }),
    leave: () => send({ type: 'leave' }),
  };
}
