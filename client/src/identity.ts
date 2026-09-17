import type { Identity } from './api';

const LAST_ROOM_KEY = 'halligalli:lastRoom';
const LAST_NAME_KEY = 'halligalli:lastName';

const key = (code: string) => `halligalli:${code.toUpperCase()}`;

export function loadIdentity(code: string): Identity | null {
  const raw = localStorage.getItem(key(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveIdentity(code: string, id: Identity) {
  localStorage.setItem(key(code), JSON.stringify(id));
  localStorage.setItem(LAST_ROOM_KEY, code.toUpperCase());
}

export function loadLastRoom(): string | null {
  return localStorage.getItem(LAST_ROOM_KEY);
}

export function clearLastRoom() {
  localStorage.removeItem(LAST_ROOM_KEY);
}

/** 방을 스스로 나갔을 때 - 이 방 신원과 "이어서 하기" 기록을 지움 */
export function forgetRoom(code: string) {
  localStorage.removeItem(key(code));
  if (loadLastRoom() === code.toUpperCase()) clearLastRoom();
}

export function loadLastName(): string {
  return localStorage.getItem(LAST_NAME_KEY) ?? '';
}

export function saveLastName(name: string) {
  localStorage.setItem(LAST_NAME_KEY, name);
}
