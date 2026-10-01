import { MAX_PLAYERS } from '../../shared/types';
import type { Fruit } from '../../shared/types';

// 방 안(웹소켓)에서 서버가 돌려주는 오류 코드 -> 안내 문구.
// BELL_WINDOW_OPEN / GAME_PAUSED / ELIMINATED는 일부러 문구를 안 보여줌
export const GAME_ERROR_KO: Record<string, string> = {
  NOT_YOUR_TURN: '아직 내 차례가 아니에요',
  NO_CARDS: '남은 카드가 없어요',
  NOT_PLAYING: '게임이 진행 중이 아니에요',
  ROOM_FULL: `방이 가득 찼어요 (최대 ${MAX_PLAYERS}명)`,
  NOT_ENOUGH_PLAYERS: '최소 2명이 있어야 시작할 수 있어요',
  NOT_HOST: '방장만 바꿀 수 있어요',
  ROOM_NOT_FOUND: '존재하지 않는 방이에요',
  ALREADY_STARTED: '게임 중에는 바꾸거나 나갈 수 없어요',
};

export const FRUIT_KO: Record<Fruit, string> = {
  strawberry: '딸기',
  banana: '바나나',
  lime: '사과', // 내부 id는 기존 저장 데이터 호환 때문에 유지, 화면 표시는 이모지(🍏)에 맞춤
  plum: '포도', // 이모지 🍇
};
