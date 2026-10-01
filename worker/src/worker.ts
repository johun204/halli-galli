import { createRoomWithRandomCode, roomStub } from './rooms';

import { MATCHMAKER_NAME } from './matchmaker';

export { RoomDurableObject } from './room-do';
export { MatchmakerDurableObject } from './matchmaker';

interface Env {
  ROOM: DurableObjectNamespace;
  MATCH: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// 프론트엔드와 API를 같은 워커가 같은 주소에서 서빙하므로 CORS 헤더는 필요 없음
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function forward(stub: DurableObjectStub, path: string, request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  const target = new URL(`https://do${path}${search}`);
  return stub.fetch(new Request(target, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    // /api/* 가 아니면 정적 프론트엔드(React 빌드)로 위임 — Vercel/Netlify 불필요
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);

    if (parts[1] === 'rooms' && parts.length === 2 && request.method === 'POST') {
      return createRoomWithRandomCode(env.ROOM, await request.text());
    }

    // 랜덤 매칭: 전역에 하나뿐인 매칭 서버(Durable Object)에 웹소켓으로 대기열 등록
    if (parts[1] === 'match' && parts[2] === 'ws' && parts.length === 3) {
      return forward(env.MATCH.get(env.MATCH.idFromName(MATCHMAKER_NAME)), '/ws', request);
    }

    // 코드 형식이 틀리면 Durable Object를 만들지 않음
    if (parts[1] === 'rooms' && parts.length >= 4 && /^\d{4}$/.test(parts[2])) {
      const code = parts[2];
      const action = parts[3];
      const stub = roomStub(env.ROOM, code);

      if (action === 'join' && request.method === 'POST') {
        return forward(stub, '/join', request);
      }
      if (action === 'status' && request.method === 'GET') {
        return forward(stub, '/status', request);
      }
      if (action === 'ws') {
        return forward(stub, '/ws', request);
      }
    }

    return json({ error: 'NOT_FOUND' }, 404);
  },
};
