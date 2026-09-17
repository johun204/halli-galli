export { RoomDurableObject } from './room-do';

interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// 방/초대 코드 = 무작위 4자리 숫자 (총 10,000칸)
const CODE_SPACE = 10000;
// ponytail: 실제 사용 중인 코드 개수를 정확히 세는 레지스트리는 없음 - 각 시도마다 무작위로 뽑아
// 해당 코드가 이미 쓰이고 있는지 Durable Object에 직접 물어보는 확률적 방식.
// 정확한 "꽉 찼음" 판정이 필요해지면 별도의 코드 레지스트리 DO를 추가하면 됨.
const MAX_CREATE_ATTEMPTS = 20;

function randomCode(): string {
  return String(Math.floor(Math.random() * CODE_SPACE)).padStart(4, '0');
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
      const bodyText = await request.text();
      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        const code = randomCode();
        const stub = env.ROOM.get(env.ROOM.idFromName(code));
        const res = await stub.fetch('https://do/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyText,
        });
        if (res.status !== 409) return res;
      }
      return json({ error: 'ROOMS_EXHAUSTED' }, 503);
    }

    // 코드 형식이 틀리면 Durable Object를 만들지 않음
    if (parts[1] === 'rooms' && parts.length >= 4 && /^\d{4}$/.test(parts[2])) {
      const code = parts[2];
      const action = parts[3];
      const stub = env.ROOM.get(env.ROOM.idFromName(code));

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
