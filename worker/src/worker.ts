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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function forward(stub: DurableObjectStub, path: string, request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  const target = new URL(`https://do${path}${search}`);
  return stub.fetch(new Request(target, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    // /api/* 가 아니면 정적 프론트엔드(React 빌드)로 위임 — Vercel/Netlify 불필요
    if (parts[0] !== 'api') return env.ASSETS.fetch(request);

    if (parts[1] === 'time' && request.method === 'GET') {
      return json({ serverTime: Date.now() });
    }

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
        if (res.status !== 409) return withCors(res);
      }
      return json({ error: 'ROOMS_EXHAUSTED' }, 503);
    }

    if (parts[1] === 'rooms' && parts.length >= 4) {
      const code = parts[2];
      const action = parts[3];
      const stub = env.ROOM.get(env.ROOM.idFromName(code));

      if (action === 'join' && request.method === 'POST') {
        return withCors(await forward(stub, '/join', request));
      }
      if (action === 'status' && request.method === 'GET') {
        return withCors(await forward(stub, '/status', request));
      }
      if (action === 'ws') {
        return forward(stub, '/ws', request); // 웹소켓 업그레이드 응답에는 CORS 헤더를 얹지 않음
      }
    }

    return json({ error: 'NOT_FOUND' }, 404);
  },
};
