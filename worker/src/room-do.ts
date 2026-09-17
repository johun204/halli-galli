import { DurableObject } from 'cloudflare:workers';
import { Room, type RoomSnapshot } from './game';
import type { ClientMessage, ReactionEmoji, ServerMessage } from './types';

const STORAGE_KEY = 'room-snapshot';
const ALLOWED_EMOJI = new Set<ReactionEmoji>(['😄', '😛', '😭', '🥱', '😱', '🤬']);
// 전원 접속 종료 후 이만큼 지나면 방을 비움 (코드가 다시 쓰일 수 있게)
const EMPTY_ROOM_CLEANUP_MS = 60_000;

interface WsAttachment {
  playerId: string;
}

export class RoomDurableObject extends DurableObject {
  private room!: Room;
  private ready: Promise<void>;
  private emojiCounter = 0;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as Record<string, unknown>);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const snap = await ctx.storage.get<RoomSnapshot>(STORAGE_KEY);
      this.room = snap ? Room.fromSnapshot(snap) : new Room(ctx.id.name ?? '');
      this.room.onChange = () => this.persistAndBroadcast();
      this.room.isPlayerConnected = (playerId) => this.connectedIds().has(playerId);
    });
  }

  private persistAndBroadcast() {
    this.ctx.waitUntil(this.ctx.storage.put(STORAGE_KEY, this.room.toSnapshot()));
    this.broadcast();
  }

  private connectedIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const info = ws.deserializeAttachment() as WsAttachment | null;
      if (info) ids.add(info.playerId);
    }
    return ids;
  }

  private stateMessage(): string {
    const msg: ServerMessage = { type: 'state', room: this.room.toPublicState(this.connectedIds()) };
    return JSON.stringify(msg);
  }

  private broadcast() {
    const json = this.stateMessage();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        // 끊긴 소켓은 조용히 무시
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      // 이 코드로 이미 누군가 방을 만든 적 있으면(호스트가 존재) 충돌 - 워커가 다른 코드로 재시도함
      if (this.room.players.size > 0) {
        return Response.json({ error: 'CODE_TAKEN' }, { status: 409 });
      }
      const body = await request
        .json<{ name?: string; turnLimitSec?: number }>()
        .catch(() => ({ name: undefined, turnLimitSec: undefined }));
      if (typeof body.turnLimitSec === 'number') this.room.configureTurnLimit(body.turnLimitSec);
      const { playerId, secret } = this.room.addPlayer(body.name ?? '');
      return Response.json({ playerId, secret, room: this.room.toPublicState(this.connectedIds()) });
    }

    if (url.pathname === '/join') {
      // 아무도 만든 적 없는 코드 = 존재하지 않는 방
      if (this.room.players.size === 0) {
        return Response.json({ error: 'ROOM_NOT_FOUND' }, { status: 404 });
      }
      const body = await request.json<{ name?: string }>().catch(() => ({ name: undefined }));
      try {
        const { playerId, secret } = this.room.addPlayer(body.name ?? '');
        return Response.json({ playerId, secret, room: this.room.toPublicState(this.connectedIds()) });
      } catch (err) {
        return Response.json({ error: err instanceof Error ? err.message : 'ERROR' }, { status: 409 });
      }
    }

    if (url.pathname === '/status') {
      // 재접속 가능 여부만 확인. 웹소켓을 열지 않으므로 이 요청 자체는 "접속 중"으로 치지 않음.
      const playerId = url.searchParams.get('playerId') ?? '';
      const secret = url.searchParams.get('secret') ?? '';
      try {
        this.room.auth(playerId, secret);
      } catch {
        return Response.json({ valid: false });
      }
      const state = this.room.toPublicState(this.connectedIds());
      const me = state.players.find((p) => p.id === playerId);
      return Response.json({
        valid: true,
        phase: state.phase,
        connected: me?.connected ?? false,
      });
    }

    if (url.pathname === '/ws') {
      const playerId = url.searchParams.get('playerId') ?? '';
      const secret = url.searchParams.get('secret') ?? '';
      try {
        this.room.auth(playerId, secret);
      } catch {
        return new Response('unauthorized', { status: 401 });
      }

      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ playerId } satisfies WsAttachment);
      this.room.reconcileTurnTimerFor(playerId); // 지금 이 사람 차례였다면 원래 제한시간으로 리셋
      await this.ctx.storage.deleteAlarm(); // 누군가 들어왔으니 예정돼 있던 방 정리를 취소
      this.broadcast(); // 본인 포함 전원에게 최신 상태 + 접속 상태(초록 점) 갱신

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const info = ws.deserializeAttachment() as WsAttachment | null;
    if (!info) return;

    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      return;
    }

    if (parsed.type === 'emoji') {
      if (!ALLOWED_EMOJI.has(parsed.emoji)) return;
      // 게임 진행 상태와 무관한 일회성 이펙트라 room 상태/저장을 안 건드리고 그냥 전원에게 흘려보냄
      const msg: ServerMessage = { type: 'emoji', id: ++this.emojiCounter, playerId: info.playerId, emoji: parsed.emoji };
      const json = JSON.stringify(msg);
      for (const s of this.ctx.getWebSockets()) {
        try {
          s.send(json);
        } catch {
          // 끊긴 소켓은 조용히 무시
        }
      }
      return;
    }

    try {
      if (parsed.type === 'start') this.room.start(info.playerId);
      else if (parsed.type === 'flip') this.room.flip(info.playerId);
      else if (parsed.type === 'bell') this.room.bell(info.playerId, parsed.correctedServerTime);
      else if (parsed.type === 'setTurnLimit') this.room.updateTurnLimit(info.playerId, parsed.sec);
    } catch (err) {
      const msg: ServerMessage = { type: 'error', error: err instanceof Error ? err.message : 'ERROR' };
      ws.send(JSON.stringify(msg));
    }
  }

  async webSocketClose(ws: WebSocket) {
    const info = ws.deserializeAttachment() as WsAttachment | null;
    if (info) this.room.reconcileTurnTimerFor(info.playerId); // 지금 이 사람 차례였다면 최소시간으로 단축
    await this.scheduleCleanupIfEmpty();
    this.broadcast();
  }

  async webSocketError(ws: WebSocket) {
    const info = ws.deserializeAttachment() as WsAttachment | null;
    if (info) this.room.reconcileTurnTimerFor(info.playerId);
    await this.scheduleCleanupIfEmpty();
    this.broadcast();
  }

  private async scheduleCleanupIfEmpty() {
    // getWebSockets()에 방금 끊긴 소켓이 아직 남아있을 수 있어 실제로 열려있는 것만 셈
    const stillConnected = this.ctx.getWebSockets().some((ws) => ws.readyState === WebSocket.OPEN);
    if (!stillConnected) {
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_CLEANUP_MS);
    }
  }

  /** 예약된 정리 시각이 되면 호출됨 - 그 사이 아무도 안 돌아왔으면 방을 완전히 비움 */
  async alarm() {
    const stillConnected = this.ctx.getWebSockets().some((ws) => ws.readyState === WebSocket.OPEN);
    if (stillConnected) return; // 그 사이 누가 다시 들어옴 - 정리 취소
    await this.ctx.storage.deleteAll();
    this.room = new Room(this.room.code);
    this.room.onChange = () => this.persistAndBroadcast();
    this.room.isPlayerConnected = (playerId) => this.connectedIds().has(playerId);
  }
}
