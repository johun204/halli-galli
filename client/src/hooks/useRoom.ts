import { useEffect, useRef, useState } from 'react';
import { checkRoomStatus, correctedNow, syncClock, wsUrl, type Identity } from '../api';
import type { ClientMessage, ReactionEmoji, RoomPublicState, ServerMessage } from '../types';

const RECONNECT_MS = 1500;

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
  // 이 방/신원 조합으로 웹소켓 핸드셰이크가 한 번이라도 성공했는지 - 방이 없어졌거나
  // 이 신원이 더 이상 유효하지 않으면 서버가 업그레이드 자체를 거부(401)해서 절대 성공하지 않음
  const [unreachable, setUnreachable] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    syncClock();
    const t = setInterval(() => syncClock(3), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let everHandshaked = false;

    function connect() {
      const ws = new WebSocket(wsUrl(code, identity));
      wsRef.current = ws;

      ws.onopen = () => {
        everHandshaked = true;
        setConnected(true);
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
        }
      };

      ws.onclose = async () => {
        setConnected(false);
        if (cancelled) return;

        if (!everHandshaked) {
          // 한 번도 연결에 성공한 적이 없음 - 진짜 없어진 방/신원인지 확인
          const status = await checkRoomStatus(code, identity).catch(() => null);
          if (cancelled) return;
          if (status && !status.valid) {
            setUnreachable(true);
            return; // 재시도 중단
          }
        }
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
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
    ringBell: () => send({ type: 'bell', correctedServerTime: correctedNow() }),
    sendEmoji: (emoji: ReactionEmoji) => send({ type: 'emoji', emoji }),
    setTurnLimit: (sec: number) => send({ type: 'setTurnLimit', sec }),
  };
}
