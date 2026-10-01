# 🔔 할리갈리 (온라인)

초대 링크나 랜덤 매칭으로 모여서 즐기는 실시간 할리갈리. Cloudflare Workers + Durable Objects 하나로 프론트엔드와 게임 서버를 함께 서빙합니다.

## 구조

| 경로 | 내용 |
| --- | --- |
| `client/` | React + Vite 프론트엔드 (PWA) |
| `worker/src/worker.ts` | HTTP 라우터 — `/api/*`는 게임 API, 나머지는 `client/dist` 정적 파일 |
| `worker/src/room-do.ts`, `game.ts` | 방 하나 = Durable Object 하나. 게임 규칙, 턴 타이머, 종 판정 |
| `worker/src/matchmaker.ts` | 랜덤 매칭 서버 (전역 Durable Object 하나) |
| `shared/types.ts` | 서버와 클라이언트가 함께 쓰는 타입과 메시지 프로토콜 |

### 종 판정 (느린 인터넷 보정)

- 정답 여부: 종을 누른 순간 **그 사람 화면에 보이던 카드** 기준
- 정답자끼리의 승부: 각자 화면에 5가 **처음 보인 순간부터 누르기까지의 반응시간**. 기기 안에서 잰 시간 차라 시계 오차와 무관
- 조작 방지: 반응시간은 `종이 서버에 도착한 시각 − 카드 시각 − 서버가 잰 왕복지연 − 80ms` 이상만 인정
- 판정 창: 500ms + 게임 중인 사람 중 가장 느린 사람의 왕복지연 (최대 1.5초)

## 개발

```bash
cd client && npm ci && npm run build   # 워커가 client/dist를 서빙
cd ../worker && npm ci
npm run dev                            # http://localhost:8787
npm test                               # 게임 로직 테스트
```

프론트엔드만 고칠 때는 `worker`에서 `npm run dev`를 띄운 채 `client`에서 `npm run dev` (Vite가 `/api`를 8787로 프록시).

## 배포

`main`에 푸시하면 Cloudflare Workers Builds가 자동으로 배포합니다.

- 루트 디렉터리: `/`
- 빌드 명령: `npm ci --prefix client && npm ci --prefix worker`
- 배포 명령: `npm run deploy --prefix worker` (클라이언트 빌드 후 `wrangler deploy`)

직접 배포하려면 `cd worker && npm run deploy`.
