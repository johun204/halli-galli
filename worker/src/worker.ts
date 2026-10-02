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

/**
 * 카카오톡 등 링크 미리보기용 og 태그 채우기. 미리보기 수집기는 이미지 주소를 절대 경로로만 인식하므로
 * 요청이 들어온 주소 기준으로 바꿔주고, 초대 링크(/room/1234)면 방 코드가 들어간 제목/설명으로 바꿈.
 */
function withLinkPreview(res: Response, url: URL): Response {
  if (!res.headers.get('content-type')?.includes('text/html')) return res;
  const room = url.pathname.match(/^\/room\/(\d{4})$/)?.[1];
  const setContent = (content: string) => ({
    element(el: Element) {
      el.setAttribute('content', content);
    },
  });
  let rewriter = new HTMLRewriter()
    .on('meta[property="og:image"]', setContent(`${url.origin}/og-image.png`))
    .on('meta[property="og:url"]', setContent(`${url.origin}${url.pathname}`));
  if (room) {
    const title = `할리갈리 초대장 · ${room}번 방`;
    const desc = `${room}번 방에서 같이 할리갈리 해요! 링크를 누르면 닉네임만 입력하고 바로 참가할 수 있어요.`;
    rewriter = rewriter
      .on('meta[property="og:title"]', setContent(title))
      .on('meta[property="og:description"]', setContent(desc))
      .on('meta[name="description"]', setContent(desc));
  }
  return rewriter.transform(res);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    // /api/* 가 아니면 정적 프론트엔드(React 빌드)로 위임 — Vercel/Netlify 불필요
    if (parts[0] !== 'api') return withLinkPreview(await env.ASSETS.fetch(request), url);

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
