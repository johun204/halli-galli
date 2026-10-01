import { DurableObject } from 'cloudflare:workers';
import { pickRoom } from './match-logic';
import { createRoomWithRandomCode, roomStub } from './rooms';
import { type MatchServerMessage, type PublicRoomSummary, type RoomPublicState } from '../../shared/types';

/** 매칭 서버는 전역에 하나 - 이 이름으로 Durable Object를 찾음 */
export const MATCHMAKER_NAME = 'global';

const STORAGE_KEY = 'public-rooms';
// 매칭 서버가 방금 만들었거나 사람을 넣은 방은, 방장이 아직 웹소켓을 못 열었어도(접속 0명) 잠시 동안은 살아있는 방으로 침
const FRESH_ROOM_GRACE_MS = 15_000;
// 클라이언트가 이 문자열을 보내면 DO를 깨우지 않고 런타임이 바로 응답함 (프록시가 유휴 연결을 끊지 않게)
export const MATCH_KEEPALIVE = 'ping';

interface Env {
  ROOM: DurableObjectNamespace;
}

interface WaiterAttachment {
  name: string;
  joinedAt: number;
}

export class MatchmakerDurableObject extends DurableObject<Env> {
  private rooms = new Map<string, PublicRoomSummary>();
  private freshUntil = new Map<string, number>();
  private ready: Promise<void>;
  // 매칭은 한 번에 하나씩만 (방 참가 요청을 기다리는 사이 다른 요청이 끼어들어 같은 자리를 두 번 쓰지 않게)
  private lock: Promise<void> = Promise.resolve();
  private done = new WeakSet<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(MATCH_KEEPALIVE, 'pong'));
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Record<string, PublicRoomSummary>>(STORAGE_KEY);
      if (saved) this.rooms = new Map(Object.entries(saved));
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const name = (url.searchParams.get('name') ?? '').trim().slice(0, 20);
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ name, joinedAt: Date.now() } satisfies WaiterAttachment);
      this.scheduleMatching();
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/room-update' && request.method === 'POST') {
      const body = await request.json<{ code?: unknown; summary?: PublicRoomSummary | null }>().catch(() => null);
      if (!body || typeof body.code !== 'string') return new Response('bad request', { status: 400 });
      const prev = this.rooms.get(body.code);
      if (!body.summary) {
        this.rooms.delete(body.code);
        this.freshUntil.delete(body.code);
      } else if (!prev || prev.at <= body.summary.at) {
        this.rooms.set(body.code, body.summary);
      }
      await this.persist();
      // 공개 방에 자리가 났으면 기다리던 사람을 넣어봄 (응답은 기다리지 않음 - 그 방이 지금 우리 참가 요청을 처리 중일 수 있음)
      this.scheduleMatching();
      return new Response(null, { status: 204 });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage() {
    // 대기자는 메시지를 보내지 않음 (keepalive는 런타임이 자동 응답). 취소 = 연결 끊기
  }

  async webSocketClose(ws: WebSocket) {
    this.done.add(ws);
    this.broadcastWaiting();
  }

  async webSocketError(ws: WebSocket) {
    this.done.add(ws);
    this.broadcastWaiting();
  }

  private persist() {
    return this.ctx.storage.put(STORAGE_KEY, Object.fromEntries(this.rooms));
  }

  /** 아직 매칭을 기다리는 사람들, 먼저 온 순서대로 */
  private waiters(): { ws: WebSocket; info: WaiterAttachment }[] {
    return this.ctx
      .getWebSockets()
      .filter((ws) => !this.done.has(ws) && ws.readyState === WebSocket.OPEN)
      .map((ws) => ({ ws, info: ws.deserializeAttachment() as WaiterAttachment }))
      .filter((w) => w.info)
      .sort((a, b) => a.info.joinedAt - b.info.joinedAt);
  }

  private send(ws: WebSocket, msg: MatchServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 이미 끊긴 소켓
    }
  }

  private broadcastWaiting() {
    const waiters = this.waiters();
    for (const w of waiters) this.send(w.ws, { type: 'waiting', waiting: waiters.length });
  }

  /** 방 신원을 넘겨주고 대기열에서 뺌 */
  private finish(ws: WebSocket, code: string, res: { playerId: string; secret: string }) {
    this.done.add(ws);
    this.send(ws, { type: 'matched', code, playerId: res.playerId, secret: res.secret });
    try {
      ws.close(1000, 'matched');
    } catch {
      // 이미 끊긴 소켓
    }
  }

  private scheduleMatching() {
    this.lock = this.lock
      .then(() => this.runMatching())
      .catch(() => undefined)
      .then(() => this.broadcastWaiting());
  }

  /**
   * 1) 모르는 사람 참여가 켜진 방에 빈 자리가 있으면 먼저 온 대기자부터 넣음
   * 2) 그런 방이 없고 대기자가 2명 이상이면, 가장 먼저 기다린 사람을 방장으로 공개 방을 새로 만들고
   *    나머지 대기자는 1)에 따라 그 방으로 들어감
   */
  private async runMatching() {
    for (;;) {
      const waiters = this.waiters();
      if (waiters.length === 0) return;

      const target = pickRoom(this.rooms.values(), Date.now(), this.freshUntil);
      if (target) {
        const w = waiters[0];
        const res = await roomStub(this.env.ROOM, target.code).fetch('https://do/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: w.info.name, viaMatch: true }),
        });
        const data = await res.json<{ playerId?: string; secret?: string; room?: RoomPublicState; error?: string }>();
        if (res.ok && data.playerId && data.secret && data.room) {
          this.rememberRoom(data.room);
          this.finish(w.ws, target.code, { playerId: data.playerId, secret: data.secret });
        } else {
          // 가득 찼거나 / 게임이 시작됐거나 / 공개를 껐거나 / 사라진 방 - 다음 소식이 올 때까지 후보에서 뺌
          this.rooms.delete(target.code);
          this.freshUntil.delete(target.code);
          await this.persist();
        }
        continue;
      }

      if (waiters.length < 2) return;

      const host = waiters[0];
      const res = await createRoomWithRandomCode(
        this.env.ROOM,
        JSON.stringify({ name: host.info.name, isPublic: true }),
      );
      const data = await res.json<{ playerId?: string; secret?: string; room?: RoomPublicState; error?: string }>();
      if (!res.ok || !data.playerId || !data.secret || !data.room) {
        for (const w of waiters) this.send(w.ws, { type: 'error', error: data.error ?? 'MATCH_FAILED' });
        return;
      }
      this.rememberRoom(data.room);
      this.finish(host.ws, data.room.code, { playerId: data.playerId, secret: data.secret });
    }
  }

  /** 방금 참가/생성 응답으로 받은 최신 방 상태를 바로 반영 (방이 보내는 알림은 비동기라 늦게 올 수 있음) */
  private rememberRoom(room: RoomPublicState) {
    const now = Date.now();
    this.freshUntil.set(room.code, now + FRESH_ROOM_GRACE_MS);
    this.rooms.set(room.code, {
      code: room.code,
      phase: room.phase,
      playerCount: room.players.length,
      connectedCount: room.players.filter((p) => p.connected).length,
      at: now,
    });
    this.ctx.waitUntil(this.persist());
  }
}
