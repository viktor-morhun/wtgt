import { useSyncExternalStore } from 'react';
import { isRoomCode, RATES, type Rate } from '@wtgt/shared';

/**
 * Комнаты, в которых зритель был: тайтл, серия и время — в браузере, без аккаунта.
 * По ним главная показывает «недавние», а пересозданная комната продолжает с того же места.
 */
export type RoomEntry = {
  code: string;
  alias: string;
  title: string;
  poster: string | null;
  episodeId: string;
  /** номер серии для подписи */
  ordinal: number;
  /** секунды */
  position: number;
  /** длительность серии; 0 — неизвестна */
  duration: number;
  rate: Rate;
  /** Date.now() последнего сохранения */
  at: number;
};

const KEY = 'wtgt.rooms';
/** Столько последних комнат помним. */
const MAX = 20;
const subs = new Set<() => void>();

const isEntry = (e: unknown): e is RoomEntry => {
  const r = e as Partial<RoomEntry> | null;
  return (
    !!r &&
    typeof r.code === 'string' &&
    isRoomCode(r.code) &&
    typeof r.alias === 'string' &&
    typeof r.title === 'string' &&
    typeof r.episodeId === 'string' &&
    typeof r.ordinal === 'number' &&
    typeof r.position === 'number' &&
    Number.isFinite(r.position) &&
    r.position >= 0 &&
    typeof r.duration === 'number' &&
    RATES.includes(r.rate as Rate) &&
    typeof r.at === 'number'
  );
};

function load(): RoomEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return Array.isArray(raw)
      ? raw
          .filter(isEntry)
          .map((e) => ({ ...e, poster: typeof e.poster === 'string' ? e.poster : null }))
          .sort((a, b) => b.at - a.at)
          .slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

let current = load();

function write(next: RoomEntry[]): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // без хранилища история живёт до перезагрузки
  }
  for (const f of subs) f();
}

export function saveRoom(entry: RoomEntry): void {
  write([entry, ...current.filter((e) => e.code !== entry.code)].slice(0, MAX));
}

export function removeRoom(code: string): void {
  write(current.filter((e) => e.code !== code));
}

export const getRoom = (code: string): RoomEntry | null => current.find((e) => e.code === code) ?? null;

// другая вкладка смотрит другую комнату — подхватываем её сохранения
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  current = load();
  for (const f of subs) f();
});

function subscribe(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

export const useRooms = (): RoomEntry[] => useSyncExternalStore(subscribe, () => current);
