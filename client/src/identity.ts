import type { Identity } from './api';

const LAST_ROOM_KEY = 'halligalli:lastRoom';

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
