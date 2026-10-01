// 방 생성/참가를 Room Durable Object에 요청하는 공용 함수 - HTTP 라우터(worker.ts)와 매칭 서버(matchmaker.ts)가 같이 씀

// 방/초대 코드 = 무작위 4자리 숫자 (총 10,000칸)
const CODE_SPACE = 10000;
// ponytail: 실제 사용 중인 코드 개수를 정확히 세는 레지스트리는 없음 - 각 시도마다 무작위로 뽑아
// 해당 코드가 이미 쓰이고 있는지 Durable Object에 직접 물어보는 확률적 방식.
// 정확한 "꽉 찼음" 판정이 필요해지면 별도의 코드 레지스트리 DO를 추가하면 됨.
const MAX_CREATE_ATTEMPTS = 20;

function randomCode(): string {
  return String(Math.floor(Math.random() * CODE_SPACE)).padStart(4, '0');
}

export function roomStub(ns: DurableObjectNamespace, code: string): DurableObjectStub {
  return ns.get(ns.idFromName(code));
}

/** 빈 코드를 찾아 방을 만듦. body는 Room DO의 /create가 받는 JSON 문자열 ({ name, turnLimitSec, isPublic }) */
export async function createRoomWithRandomCode(ns: DurableObjectNamespace, bodyText: string): Promise<Response> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    const res = await roomStub(ns, randomCode()).fetch('https://do/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    });
    if (res.status !== 409) return res;
  }
  return Response.json({ error: 'ROOMS_EXHAUSTED' }, { status: 503 });
}
